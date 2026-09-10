"""Validate repository-owned harness profiles and shared workflow links only.

SKILL.md routing metadata is also checked by the system skill-creator validator.
This static check does not claim actual harness permissions or behavioral quality.
"""
from pathlib import Path
import sys

root = Path(__file__).resolve().parent.parent
if "--claude" in sys.argv:
    import yaml
    text = (root / ".claude/agents/video-critic.md").read_text()
    assert text.startswith("---\n")
    claude = yaml.safe_load(text.split("---", 2)[1])
    assert claude["name"] == "video-critic"
    assert claude["model"] == "inherit"
    assert claude["skills"] == ["video-review"]
    assert {tool.strip() for tool in claude["tools"].split(",")} == {"Read", "Glob", "Grep"}
    print("Claude critic YAML is valid (existing PyYAML interpreter).")
    raise SystemExit(0)
import tomllib
codex = tomllib.loads((root / ".codex/agents/video-critic.toml").read_text())
for key in ("name", "description", "developer_instructions"):
    assert isinstance(codex.get(key), str) and codex[key].strip(), key
assert codex["name"] == "video-critic"
assert codex["sandbox_mode"] == "read-only"
assert "model" not in codex, "Inherit the actual user's model selection"

links = {
    "video-production": ".agents/skills/video-production/workflow.md",
    "video-review": ".agents/skills/video-review/workflow.md",
    "video-image": ".agents/skills/video-production/references/image-generation.md",
}
for name, target in links.items():
    link = root / ".claude/skills" / name / "workflow.md"
    assert link.is_symlink(), name
    assert link.resolve(strict=True) == (root / target).resolve(strict=True), name
assert not (root / ".agents/skills/video-image").exists(), "No new Codex image skill"
print("Codex TOML and three relative shared links are valid (Python 3.11+).")
