"""Fine-tune Qwen3-0.6B with LoRA on the private, restaurant-separated CROUS set."""

import argparse
import json
import random
from pathlib import Path

import torch
from peft import LoraConfig, get_peft_model
from torch.utils.data import DataLoader
from transformers import AutoModelForCausalLM, AutoTokenizer


def load_rows(path: Path, split: str):
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    rows = [row for row in rows if row.get("split") == split and len(row.get("messages", [])) == 3]
    if not rows:
        raise ValueError(f"No {split} examples found in {path}")
    return rows


def encode_rows(rows, tokenizer, max_length):
    encoded = []
    end_of_turn = tokenizer.encode("<|im_end|>", add_special_tokens=False)
    for row in rows:
        messages = row["messages"]
        prompt = tokenizer.apply_chat_template(messages[:-1], tokenize=True, add_generation_prompt=True)
        if hasattr(prompt, "input_ids"):
            prompt = prompt.input_ids
        elif isinstance(prompt, dict):
            prompt = prompt["input_ids"]
        if hasattr(prompt, "tolist"):
            prompt = prompt.tolist()
        if prompt and isinstance(prompt[0], list):
            prompt = prompt[0]
        answer = tokenizer.encode(messages[-1]["content"], add_special_tokens=False) + end_of_turn
        ids = (prompt + answer)[:max_length]
        labels = ([-100] * min(len(prompt), len(ids))) + answer[: max(0, len(ids) - len(prompt))]
        if len(labels) != len(ids):
            labels = labels[: len(ids)]
        encoded.append({"input_ids": ids, "labels": labels, "group": row["group"]})
    return encoded


def collate(batch, pad_id):
    width = max(len(row["input_ids"]) for row in batch)
    input_ids, labels, attention = [], [], []
    for row in batch:
        padding = width - len(row["input_ids"])
        input_ids.append(row["input_ids"] + [pad_id] * padding)
        labels.append(row["labels"] + [-100] * padding)
        attention.append([1] * len(row["input_ids"]) + [0] * padding)
    return {
        "input_ids": torch.tensor(input_ids, dtype=torch.long),
        "labels": torch.tensor(labels, dtype=torch.long),
        "attention_mask": torch.tensor(attention, dtype=torch.long),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=Path("data/private-menu-training/crous-instruct.jsonl"))
    parser.add_argument("--output", type=Path, default=Path("data/private-menu-training/qwen3-crous-lora"))
    parser.add_argument("--model", default="Qwen/Qwen3-0.6B")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--gradient-accumulation", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=1e-4)
    parser.add_argument("--max-length", type=int, default=2048)
    parser.add_argument("--seed", type=int, default=19)
    args = parser.parse_args()

    if not torch.cuda.is_available():
        raise RuntimeError("A CUDA GPU is required for this fine-tune.")
    if not torch.cuda.is_bf16_supported():
        raise RuntimeError("This training recipe requires a GPU with bfloat16 support.")
    random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.cuda.manual_seed_all(args.seed)

    train_rows = load_rows(args.data, "train")
    val_rows = load_rows(args.data, "validation")
    train_groups = {row["group"] for row in train_rows}
    val_groups = {row["group"] for row in val_rows}
    if train_groups & val_groups:
        raise ValueError("Restaurant groups overlap between train and validation splits.")

    tokenizer = AutoTokenizer.from_pretrained(args.model, use_fast=True, local_files_only=True)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    train_data = encode_rows(train_rows, tokenizer, args.max_length)
    train_loader = DataLoader(
        train_data,
        batch_size=args.batch_size,
        shuffle=True,
        collate_fn=lambda batch: collate(batch, tokenizer.pad_token_id),
    )

    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        dtype=torch.bfloat16,
        attn_implementation="sdpa",
        local_files_only=True,
    )
    model.config.use_cache = False
    model.gradient_checkpointing_enable()
    model.enable_input_require_grads()
    model = get_peft_model(
        model,
        LoraConfig(
            r=16,
            lora_alpha=32,
            lora_dropout=0.05,
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
            task_type="CAUSAL_LM",
        ),
    )
    model = model.to("cuda")
    model.print_trainable_parameters()
    optimizer = torch.optim.AdamW((p for p in model.parameters() if p.requires_grad), lr=args.learning_rate)
    optimizer.zero_grad(set_to_none=True)
    model.train()

    global_step = 0
    for epoch in range(args.epochs):
        total_loss = 0.0
        for step, batch in enumerate(train_loader, start=1):
            batch = {key: value.to("cuda") for key, value in batch.items()}
            loss = model(**batch).loss
            (loss / args.gradient_accumulation).backward()
            total_loss += loss.detach().item()
            if step % args.gradient_accumulation == 0 or step == len(train_loader):
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optimizer.step()
                optimizer.zero_grad(set_to_none=True)
                global_step += 1
            if step % 50 == 0:
                print(f"epoch={epoch + 1} step={step}/{len(train_loader)} loss={loss.item():.4f}", flush=True)
        print(f"epoch={epoch + 1} mean_loss={total_loss / len(train_loader):.4f}", flush=True)

    args.output.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(args.output)
    tokenizer.save_pretrained(args.output)
    metadata = {
        "baseModel": args.model,
        "dataset": str(args.data),
        "epochs": args.epochs,
        "learningRate": args.learning_rate,
        "batchSize": args.batch_size,
        "gradientAccumulation": args.gradient_accumulation,
        "maxLength": args.max_length,
        "trainExamples": len(train_rows),
        "validationExamples": len(val_rows),
        "trainRestaurantGroups": len(train_groups),
        "validationRestaurantGroups": len(val_groups),
        "restaurantGroupOverlap": 0,
        "globalSteps": global_step,
        "seed": args.seed,
        "trainingNote": "LoRA adapter only; held-out generation evaluation is a separate required step.",
    }
    (args.output / "training-manifest.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(f"Saved adapter and manifest to {args.output}")


if __name__ == "__main__":
    main()
