"""Restaurant-held-out generation metrics for the CROUS instruction set."""

import argparse
import json
import re
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer


def extract_json(text):
    text = re.sub(r"<think>[\s\S]*?</think>", "", text).strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        value = json.loads(text[start : end + 1])
        return value if isinstance(value, dict) else None
    except json.JSONDecodeError:
        return None


def names(value):
    items = value.get("items", []) if isinstance(value, dict) else []
    if not isinstance(items, list):
        return []
    return [item.get("name", "").strip().casefold() for item in items if isinstance(item, dict) and isinstance(item.get("name"), str) and item["name"].strip()]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=Path("data/private-menu-training/crous-instruct.jsonl"))
    parser.add_argument("--adapter", type=Path)
    parser.add_argument("--model", default="Qwen/Qwen3-0.6B")
    parser.add_argument("--output", type=Path, default=Path("data/private-menu-training/evaluation.json"))
    parser.add_argument("--limit", type=int, default=0, help="Evaluate all examples when zero.")
    parser.add_argument("--max-new-tokens", type=int, default=1100)
    args = parser.parse_args()

    rows = [json.loads(line) for line in args.data.read_text(encoding="utf-8").splitlines() if line.strip()]
    rows = [row for row in rows if row.get("split") == "validation"]
    if args.limit:
        rows = rows[: args.limit]
    if not rows:
        raise ValueError("No held-out validation examples found.")
    if not torch.cuda.is_available():
        raise RuntimeError("A CUDA GPU is required for generation evaluation.")

    tokenizer = AutoTokenizer.from_pretrained(args.adapter or args.model, use_fast=True, local_files_only=True)
    model = AutoModelForCausalLM.from_pretrained(args.model, dtype=torch.bfloat16, attn_implementation="sdpa", local_files_only=True).to("cuda")
    if args.adapter:
        model = PeftModel.from_pretrained(model, args.adapter)
    model.eval()
    counts = {"validJson": 0, "expectedItems": 0, "predictedItems": 0, "exactMatches": 0, "sectionMatches": 0, "groundedQuotes": 0, "examples": len(rows)}
    records = []

    for index, row in enumerate(rows, start=1):
        messages = row["messages"]
        prompt = tokenizer.apply_chat_template(messages[:-1], tokenize=False, add_generation_prompt=True, enable_thinking=False)
        input_ids = tokenizer(prompt, return_tensors="pt").input_ids.to("cuda")
        with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
            generated = model.generate(input_ids, max_new_tokens=args.max_new_tokens, do_sample=False, use_cache=True)
        text = tokenizer.decode(generated[0][input_ids.shape[1] :], skip_special_tokens=True)
        parsed = extract_json(text)
        expected = json.loads(messages[-1]["content"])
        expected_names = set(names(expected))
        predicted_names = set(names(parsed))
        source = messages[1]["content"].casefold()
        items = parsed.get("items", []) if parsed else []
        quote_count = sum(1 for item in items if isinstance(item, dict) and isinstance(item.get("sourceText"), str) and item.get("name", "").casefold() in item["sourceText"].casefold() and item["sourceText"].casefold() in source)
        sections = {(item.get("name", "").casefold(), item.get("section", "").casefold()) for item in items if isinstance(item, dict)}
        expected_sections = {(item["name"].casefold(), item["section"].casefold()) for item in expected.get("items", [])}
        counts["validJson"] += parsed is not None
        counts["expectedItems"] += len(expected_names)
        counts["predictedItems"] += len(predicted_names)
        counts["exactMatches"] += len(expected_names & predicted_names)
        counts["sectionMatches"] += len(expected_sections & sections)
        counts["groundedQuotes"] += quote_count
        records.append({"index": index, "group": row["group"], "expected": sorted(expected_names), "predicted": sorted(predicted_names), "jsonValid": parsed is not None, "groundedQuotes": quote_count, "raw": text[:5000]})
        if index % 10 == 0:
            print(f"evaluated={index}/{len(rows)}", flush=True)

    predicted = counts["predictedItems"]
    expected = counts["expectedItems"]
    metrics = {
        **counts,
        "jsonValidity": counts["validJson"] / counts["examples"],
        "itemPrecision": counts["exactMatches"] / predicted if predicted else 0,
        "itemRecall": counts["exactMatches"] / expected if expected else 0,
        "itemF1": 2 * counts["exactMatches"] / (predicted + expected) if predicted + expected else 0,
        "sectionPairRecall": counts["sectionMatches"] / expected if expected else 0,
        "groundedQuoteRate": counts["groundedQuotes"] / predicted if predicted else 0,
        "adapter": str(args.adapter) if args.adapter else None,
        "baseModel": args.model,
        "evaluationSplit": "restaurant-held-out validation split",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"metrics": metrics, "examples": records}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metrics, ensure_ascii=False, indent=2))
    print(f"Detailed report: {args.output}")


if __name__ == "__main__":
    main()
