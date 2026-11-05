"""Tests for scripts/sync_from_desk.py. Run: python3 -m unittest discover tests"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import sync_from_desk as s  # noqa: E402

HEADER = "provider,gpu,price_usd_per_gpu_hr,source_url,date_checked\n"


def make_source(tmp, rows=1, price="2.00"):
    d = tmp / "src" / "data"
    (d / "history").mkdir(parents=True, exist_ok=True)
    (d / "gpu_prices.csv").write_text(HEADER + f"Lambda,H100,{price},https://x,2026-11-04\n")
    (d / "gpu_prices.json").write_text(json.dumps({"meta": {}, "data": [{}] * rows}))
    (d / "history" / "2026-11-04.json").write_text("{}")
    return tmp / "src"


def commits(path):
    out = subprocess.run(["git", "log", "--oneline"], cwd=path, capture_output=True, text=True).stdout
    return out.count("Data refresh")


class SyncTests(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.tmp = Path(self._t.name)
        self.dest = self.tmp / "dest"

    def tearDown(self):
        self._t.cleanup()

    def test_copies_files_and_history(self):
        changed = s.copy_data(make_source(self.tmp), self.dest)
        self.assertIn("data/gpu_prices.csv", changed)
        self.assertTrue((self.dest / "data/history/2026-11-04.json").exists())

    def test_second_run_reports_no_changes(self):
        src = make_source(self.tmp)
        s.copy_data(src, self.dest)
        self.assertEqual(s.copy_data(src, self.dest), [])

    def test_dry_run_writes_nothing(self):
        self.assertTrue(s.copy_data(make_source(self.tmp), self.dest, dry_run=True))
        self.assertFalse((self.dest / "data").exists())

    def test_rejects_empty_json(self):
        with self.assertRaises(ValueError):
            s.copy_data(make_source(self.tmp, rows=0), self.dest)

    def test_rejects_missing_column(self):
        src = make_source(self.tmp)
        (src / "data/gpu_prices.csv").write_text("provider,gpu\nA,B\n")
        with self.assertRaises(ValueError):
            s.copy_data(src, self.dest)

    def test_main_commits_only_on_change(self):
        src = make_source(self.tmp)
        self.dest.mkdir()
        for c in (["init", "-q"], ["config", "user.email", "t@example.com"], ["config", "user.name", "t"]):
            subprocess.run(["git", *c], cwd=self.dest, check=True)
        args = ["--source", str(src), "--dest", str(self.dest), "--no-push"]
        s.main(args)
        self.assertEqual(commits(self.dest), 1)
        s.main(args)
        self.assertEqual(commits(self.dest), 1)
        make_source(self.tmp, price="2.10")
        s.main(args)
        self.assertEqual(commits(self.dest), 2)


if __name__ == "__main__":
    unittest.main()
