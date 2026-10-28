diff --git a/chrome/browser/browseros/server/stage_aster_server.py b/chrome/browser/browseros/server/stage_aster_server.py
new file mode 100644
--- /dev/null
+++ b/chrome/browser/browseros/server/stage_aster_server.py
@@ -0,0 +1,51 @@
+#!/usr/bin/env python3
+"""Stage the prepared Aster debug server without losing executable modes."""
+import shutil
+import sys
+from pathlib import Path
+
+
+def _path_without_symlink_components(path: Path) -> Path:
+    """Normalize lexically while rejecting symlinks before following them."""
+    candidate = path if path.is_absolute() else Path.cwd() / path
+    current = Path(candidate.anchor)
+    for part in candidate.parts[1:]:
+        if part in ("", "."):
+            continue
+        if part == "..":
+            current = current.parent
+            continue
+        current = current / part
+        if current.is_symlink():
+            raise RuntimeError(f"Refusing symlink path component: {current}")
+    return current
+
+
+def main():
+    if len(sys.argv) != 4:
+        raise SystemExit("usage: stage_aster_server.py SOURCE TARGET STAMP")
+    source, target, stamp = (
+        _path_without_symlink_components(Path(arg)) for arg in sys.argv[1:]
+    )
+    if not source.is_dir() or source.is_symlink():
+        raise RuntimeError("Aster server resources are missing")
+    if source == target or source in target.parents or target in source.parents:
+        raise RuntimeError("Source and target must be independent")
+    for path in source.rglob("*"):
+        if path.is_symlink() or not (path.is_file() or path.is_dir()):
+            raise RuntimeError("Unsafe Aster server resource")
+    for rel in ("bin/aster_server", "bin/third_party/bun"):
+        path = source / rel
+        if not path.is_file() or not path.stat().st_mode & 0o111:
+            raise RuntimeError("Aster server executable is missing or not executable")
+    if target.exists():
+        if target.is_symlink() or not target.is_dir():
+            raise RuntimeError("Unsafe Aster server destination")
+        shutil.rmtree(target)
+    target.parent.mkdir(parents=True, exist_ok=True)
+    shutil.copytree(source, target, copy_function=shutil.copy2)
+    stamp.write_text("Aster server resources staged\n", encoding="utf-8")
+
+
+if __name__ == "__main__":
+    main()
