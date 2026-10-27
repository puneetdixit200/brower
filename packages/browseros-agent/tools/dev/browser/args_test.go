package browser

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"browseros-dev/proc"
)

func TestBuildArgsUsesDevDockIcon(t *testing.T) {
	args := BuildArgs(ArgsConfig{
		Root:              "/repo/packages/browseros-agent",
		Ports:             proc.Ports{CDP: 9005, Server: 9105, Extension: 9305},
		UserDataDir:       "/tmp/browseros-dev",
		LoadDevExtensions: true,
	})
	joined := strings.Join(args, "\n")
	if !strings.Contains(joined, "--browseros-dock-icon=dev") {
		t.Fatalf("missing dev dock icon arg in\n%s", joined)
	}
	for _, want := range []string{
		"--browseros-mcp-port=9105",
		"--browseros-server-port=9105",
		"--browseros-proxy-port=9105",
	} {
		if !strings.Contains(joined, want) {
			t.Errorf("missing synchronized BrowserOS API port %q in\n%s", want, joined)
		}
	}
}

func TestBuildArgsCanDeferExtensionHomeUntilCDPIsReady(t *testing.T) {
	root := t.TempDir()
	extensionDir := filepath.Join(root, "apps/app/dist/chrome-mv3-dev")
	if err := os.MkdirAll(extensionDir, 0o700); err != nil {
		t.Fatal(err)
	}
	manifest := `{"key":"MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvBDAaDRvv61NpBeLR8etBRw82lv9VJO3sz/mA26gDzWKtVuzW4DXCl8Zfj5oWmoXLTfv3aiTigUXo/LHOoGpSucEVroMmAc7cgu2KuQ1fZPpMvYa0npD/m4h89360q8Oz0oKKaZGS905IJ04M2IkF4CuU3YEHFJBWb+cUyK9H8YVugelYbPD0IVs63T1SkGbh/t/Tfb2DpkinduSO8+x26sKydm30SRt+iZ2+7Nolcdum3LExInUiX2Pgb65Jb+mVw8NqyTVJyCEp8uq0cSHomWFQirSJ80tsDhISp4btwaRKHrXqovQx9XHQv4hCd+3LuB830eUEVMUNuCO+OyPxQIDAQAB","chrome_url_overrides":{"newtab":"app.html"}}`
	if err := os.WriteFile(filepath.Join(extensionDir, "manifest.json"), []byte(manifest), 0o600); err != nil {
		t.Fatal(err)
	}
	args := BuildArgs(ArgsConfig{
		Root:               root,
		Ports:              proc.Ports{CDP: 9005, Server: 9105, Extension: 9305},
		UserDataDir:        "/tmp/browseros-dev",
		LoadDevExtensions:  true,
		DeferExtensionHome: true,
	})
	joined := strings.Join(args, "\n")
	if !strings.Contains(joined, "--load-extension="+extensionDir) {
		t.Fatalf("missing development extension path in\n%s", joined)
	}
	if strings.Contains(joined, "chrome://newtab") {
		t.Fatalf("must not force the restricted BrowserOS new-tab URL in\n%s", joined)
	}
	if strings.Contains(joined, "chrome-extension://bflpfmnmnokmjhmgnolecpppdbdophmk/app.html#/home") {
		t.Fatalf("extension home should be opened after CDP sees the extension worker; args:\n%s", joined)
	}

	legacyArgs := BuildArgs(ArgsConfig{
		Root:              root,
		Ports:             proc.Ports{CDP: 9005, Server: 9105, Extension: 9305},
		UserDataDir:       "/tmp/browseros-dev",
		LoadDevExtensions: true,
	})
	if !strings.Contains(strings.Join(legacyArgs, "\n"), "chrome-extension://bflpfmnmnokmjhmgnolecpppdbdophmk/app.html#/home") {
		t.Fatal("expected direct extension home URL when deferral is disabled")
	}
}

func TestResolveInstalledBinaryUsesLinuxOverride(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux binary resolution")
	}
	t.Setenv("ASTER_BROWSER_BINARY", "/home/test/.local/opt/aster/browseros.AppImage")
	t.Setenv("ASTER_BROWSER_BIN", "/home/test/.local/opt/aster/browseros-bin.AppImage")
	t.Setenv("BROWSEROS_BINARY", "/usr/bin/browseros")

	got := ResolveInstalledBinary(ProductBrowserOS)
	if got.Path != "/home/test/.local/opt/aster/browseros-bin.AppImage" || got.Product != ProductBrowserOS {
		t.Fatalf("ResolveInstalledBinary got %#v", got)
	}
}

func TestResolveInstalledBinaryUsesBrowserOSOverrideFallback(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux binary resolution")
	}
	t.Setenv("ASTER_BROWSER_BINARY", "")
	t.Setenv("ASTER_BROWSER_BIN", "")
	t.Setenv("BROWSEROS_BINARY", "/usr/bin/browseros")

	got := ResolveInstalledBinary(ProductBrowserOS)
	if got.Path != "/usr/bin/browseros" {
		t.Fatalf("ResolveInstalledBinary got %#v", got)
	}
}

func TestResolveInstalledBinaryHasActionableLinuxDefault(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux binary resolution")
	}
	t.Setenv("ASTER_BROWSER_BINARY", "")
	t.Setenv("ASTER_BROWSER_BIN", "")
	t.Setenv("BROWSEROS_BINARY", "")
	t.Setenv("PATH", t.TempDir())

	got := ResolveInstalledBinary(ProductBrowserOS)
	if got.Path != "browseros" {
		t.Fatalf("ResolveInstalledBinary got %#v", got)
	}
}

func TestBuildArgsUsesProductFlag(t *testing.T) {
	args := buildArgs(ArgsConfig{
		Root:              "/repo/packages/browseros-agent",
		Ports:             proc.Ports{CDP: 9005, Server: 9105, Extension: 9305},
		UserDataDir:       "/tmp/browseros-dev",
		LoadDevExtensions: true,
		Product:           ProductBrowserClaw,
	}, func(product string) BinaryResolution {
		return BinaryResolution{Product: product, Path: BrowserClawBinaryPath, PreferredPath: BrowserClawBinaryPath}
	})
	joined := strings.Join(args, "\n")
	if args[0] != BrowserClawBinaryPath {
		t.Fatalf("got binary %q want %q", args[0], BrowserClawBinaryPath)
	}
	if !strings.Contains(joined, "--browseros-product=browserclaw") {
		t.Fatalf("missing BrowserClaw product arg in\n%s", joined)
	}
}

func TestResolveBinary(t *testing.T) {
	tests := []struct {
		name          string
		product       string
		existingPaths map[string]bool
		wantProduct   string
		wantPath      string
		wantPreferred string
		wantFallback  bool
	}{
		{
			name:          "default product uses BrowserOS",
			wantProduct:   ProductBrowserOS,
			wantPath:      BrowserOSBinaryPath,
			wantPreferred: BrowserOSBinaryPath,
		},
		{
			name:          "BrowserOS product ignores BrowserClaw install",
			product:       ProductBrowserOS,
			existingPaths: map[string]bool{BrowserClawBinaryPath: true},
			wantProduct:   ProductBrowserOS,
			wantPath:      BrowserOSBinaryPath,
			wantPreferred: BrowserOSBinaryPath,
		},
		{
			name:          "BrowserClaw product uses BrowserClaw when installed",
			product:       ProductBrowserClaw,
			existingPaths: map[string]bool{BrowserClawBinaryPath: true},
			wantProduct:   ProductBrowserClaw,
			wantPath:      BrowserClawBinaryPath,
			wantPreferred: BrowserClawBinaryPath,
		},
		{
			name:          "BrowserClaw product falls back to BrowserOS when absent",
			product:       ProductBrowserClaw,
			wantProduct:   ProductBrowserClaw,
			wantPath:      BrowserOSBinaryPath,
			wantPreferred: BrowserClawBinaryPath,
			wantFallback:  true,
		},
		{
			name:          "unknown product keeps product flag but uses BrowserOS",
			product:       "custom",
			wantProduct:   "custom",
			wantPath:      BrowserOSBinaryPath,
			wantPreferred: BrowserOSBinaryPath,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ResolveBinary(tt.product, func(path string) bool {
				return tt.existingPaths[path]
			})
			if got.Product != tt.wantProduct || got.Path != tt.wantPath || got.PreferredPath != tt.wantPreferred || got.Fallback != tt.wantFallback {
				t.Fatalf("ResolveBinary got %#v", got)
			}
		})
	}
}
