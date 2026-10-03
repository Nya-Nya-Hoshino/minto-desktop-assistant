"""Record the exact installed embedded-runtime distributions and their license locations."""
from pathlib import Path
import importlib.metadata
import json

VOICE = Path(__file__).resolve().parents[1]
distributions = sorted(importlib.metadata.distributions(), key=lambda item: item.metadata["Name"].lower())
lines = ["# Exact installed Windows x64 Python 3.12 embedded runtime; recorded 2026-10-03.",
         "# Includes transitive dependencies. Install CPU torch from its official wheel index.",
         "--extra-index-url https://download.pytorch.org/whl/cpu"]
evidence = []
for distribution in distributions:
    name = distribution.metadata["Name"]
    lines.append(f"{name}=={distribution.version}")
    license_files = []
    for relative in distribution.files or []:
        if "license" in relative.name.lower() or "copying" in relative.name.lower() or "notice" in relative.name.lower():
            absolute = Path(distribution.locate_file(relative)).resolve()
            if absolute.is_file():
                license_files.append(str(absolute))
    evidence.append({"name": name, "version": distribution.version,
                     "license_expression": distribution.metadata.get("License-Expression"),
                     "license_metadata": distribution.metadata.get("License"),
                     "home_page": distribution.metadata.get("Home-page"),
                     "project_urls": distribution.metadata.get_all("Project-URL") or [],
                     "requires_dist": distribution.metadata.get_all("Requires-Dist") or [],
                     "license_files": license_files})
(VOICE / "requirements-runtime-lock.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
(Path(__file__).parent / "runtime_dependency_evidence.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Recorded {len(evidence)} installed distributions.")
