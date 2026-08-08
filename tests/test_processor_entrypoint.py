import os
import subprocess
from pathlib import Path


ENTRYPOINT = Path(__file__).parents[1] / "docker" / "processor-entrypoint.sh"


def run_entrypoint(tmp_path: Path, workers: str | None):
    fake = tmp_path / "gunicorn"
    fake.write_text('#!/bin/sh\nprintf "%s\\n" "$@"\n')
    fake.chmod(0o755)
    env = {**os.environ, "PATH": f"{tmp_path}:{os.environ['PATH']}"}
    if workers is None:
        env.pop("PROCESSOR_WORKERS", None)
    else:
        env["PROCESSOR_WORKERS"] = workers
    return subprocess.run([ENTRYPOINT], env=env, text=True, capture_output=True)


def test_processor_workers_default_and_override(tmp_path):
    assert "--workers=2" in run_entrypoint(tmp_path, None).stdout
    overridden = run_entrypoint(tmp_path, "5")
    assert overridden.returncode == 0
    assert "--workers=5" in overridden.stdout


def test_invalid_processor_workers_prevents_startup(tmp_path):
    for value in ("0", "-1", "1.5", "nope"):
        result = run_entrypoint(tmp_path, value)
        assert result.returncode != 0
        assert result.stdout == ""
        assert "positive integer" in result.stderr
