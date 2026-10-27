diff --git a/chrome/browser/browseros/bundled_extensions/stage_aster_unpacked.py b/chrome/browser/browseros/bundled_extensions/stage_aster_unpacked.py
new file mode 100644
--- /dev/null
+++ b/chrome/browser/browseros/bundled_extensions/stage_aster_unpacked.py
@@ -0,0 +1,48 @@
+#!/usr/bin/env python3
+"""GN action: stage only source-validated Aster development extension files.
+
+This is a build action, not a loader, installer, or signed CRX substitute.
+"""
+import json
+import shutil
+import sys
+from pathlib import Path
+
+
+def main() -> None:
+    if len(sys.argv) != 4:
+        raise SystemExit("usage: stage_aster_unpacked.py SOURCE TARGET STAMP")
+    source, destination, stamp = (Path(a).resolve() for a in sys.argv[1:])
+    if not source.is_dir() or source.is_symlink():
+        raise RuntimeError("Aster unpacked source tree is missing")
+    if destination == source or source in destination.parents or destination in source.parents:
+        raise RuntimeError("Aster unpacked source and output must be independent")
+    files = sorted(source.rglob("*"))
+    if not files or len(files) > 10000:
+        raise RuntimeError("Invalid unpacked resource file count")
+    for f in files:
+        if f.is_symlink() or not (f.is_file() or f.is_dir()):
+            raise RuntimeError("Aster unpacked source contains a link or special file")
+    if not (source / "manifest.json").is_file():
+        raise RuntimeError("Aster unpacked source is missing manifest.json")
+    # CRX discovery expects an on-disk JSON catalog even when this debug
+    # loader deliberately installs its unpacked extension separately.
+    catalog_source = source.parent / "bundled_extensions.json"
+    if catalog_source.is_symlink() or not catalog_source.is_file():
+        raise RuntimeError("Aster unpacked catalog is missing")
+    data = catalog_source.read_bytes()
+    if len(data) > 4096 or json.loads(data) != {}:
+        raise RuntimeError("Aster debug catalog may not declare CRX/update entries")
+    if destination.exists():
+        if destination.is_symlink() or not destination.is_dir():
+            raise RuntimeError("Unsafe existing unpacked destination")
+        shutil.rmtree(destination)
+    destination.parent.mkdir(parents=True, exist_ok=True)
+    shutil.copytree(source, destination, symlinks=False)
+    shutil.copyfile(catalog_source, destination.parent / "bundled_extensions.json")
+    stamp.parent.mkdir(parents=True, exist_ok=True)
+    stamp.write_text("Aster unpacked development source staged\n", encoding="utf-8")
+
+
+if __name__ == "__main__":
+    main()
