import unittest

from evaluate import extract_json


class ExtractJsonTests(unittest.TestCase):
    def test_parses_complete_json(self):
        payload, valid = extract_json('{"summary":"Soup","items":[{"name":"Soup","sourceText":"Soup"}]}')
        self.assertTrue(valid)
        self.assertEqual(payload["items"][0]["name"], "Soup")

    def test_recovers_complete_items_from_truncated_json(self):
        raw = '{"summary":"Menu","items":[{"name":"Soup","sourceText":"Soup {daily}"},{"name":"Salad","sourceText":"Salad\\\" special"},{"name":"unfinished'
        payload, valid = extract_json(raw)
        self.assertFalse(valid)
        self.assertEqual([item["name"] for item in payload["items"]], ["Soup", "Salad"])

    def test_does_not_recover_incomplete_item(self):
        payload, valid = extract_json('{"items":[{"name":"unfinished","sourceText":"unfinished')
        self.assertFalse(valid)
        self.assertIsNone(payload)


if __name__ == "__main__":
    unittest.main()
