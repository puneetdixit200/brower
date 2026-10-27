package browser

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"browseros-dev/proc"
)

type ArgsConfig struct {
	Root               string
	Ports              proc.Ports
	UserDataDir        string
	Headless           bool
	LoadDevExtensions  bool
	DeferExtensionHome bool
	Product            string
}

const (
	ProductBrowserOS   = "browseros"
	ProductBrowserClaw = "browserclaw"

	BrowserOSBinaryPath   = "/Applications/BrowserOS.app/Contents/MacOS/BrowserOS"
	BrowserClawBinaryPath = "/Applications/BrowserOS neo.app/Contents/MacOS/BrowserOS neo"
)

type BinaryResolution struct {
	Product       string
	Path          string
	PreferredPath string
	Fallback      bool
}

// ResolveBinary chooses the Chromium app binary for a product with an injectable existence check.
func ResolveBinary(product string, exists func(string) bool) BinaryResolution {
	product = normalizeProduct(product)
	resolution := BinaryResolution{
		Product:       product,
		Path:          BrowserOSBinaryPath,
		PreferredPath: BrowserOSBinaryPath,
	}
	if product != ProductBrowserClaw {
		return resolution
	}

	resolution.PreferredPath = BrowserClawBinaryPath
	if exists != nil && exists(BrowserClawBinaryPath) {
		resolution.Path = BrowserClawBinaryPath
		return resolution
	}
	resolution.Fallback = true
	return resolution
}

// ResolveInstalledBinary resolves the product binary against the local macOS app bundle paths.
func ResolveInstalledBinary(product string) BinaryResolution {
	if runtime.GOOS == "linux" {
		// Linux development builds use a user-selected BrowserOS-compatible
		// AppImage/binary. Never silently fall back to system Chromium: the
		// BrowserOS-specific command-line switches and extension bridge are
		// required for this harness.
		path := os.Getenv("ASTER_BROWSER_BIN")
		if path == "" {
			path = os.Getenv("ASTER_BROWSER_BINARY")
		}
		if path == "" {
			path = os.Getenv("BROWSEROS_BINARY")
		}
		if path == "" {
			path, _ = exec.LookPath("browseros")
		}
		if path == "" {
			// exec.Command will then produce the standard, actionable ENOENT
			// message for the documented `browseros` PATH entry.
			path = "browseros"
		}
		return BinaryResolution{
			Product:       normalizeProduct(product),
			Path:          path,
			PreferredPath: path,
		}
	}
	return ResolveBinary(product, binaryExists)
}

// BuildArgs returns the BrowserOS Chromium command for non-WXT dev/test launches.
func BuildArgs(cfg ArgsConfig) []string {
	return buildArgs(cfg, ResolveInstalledBinary)
}

func buildArgs(cfg ArgsConfig, resolveBinary func(string) BinaryResolution) []string {
	product := cfg.Product
	if product == "" {
		product = ProductBrowserOS
	}
	resolution := resolveBinary(product)

	args := []string{resolution.Path}

	if cfg.LoadDevExtensions {
		args = append(args, "--no-first-run", "--no-default-browser-check")
	}

	args = append(args,
		"--use-mock-keychain",
		"--show-component-extension-options",
		"--disable-browseros-server",
		"--browseros-dock-icon=dev",
		fmt.Sprintf("--browseros-product=%s", product),
	)

	if cfg.LoadDevExtensions {
		args = append(args, "--disable-browseros-extensions")
	} else {
		args = append(args, "--enable-logging=stderr")
	}

	if cfg.Headless {
		args = append(args, "--headless=new")
	}

	args = append(args,
		fmt.Sprintf("--remote-debugging-port=%d", cfg.Ports.CDP),
		fmt.Sprintf("--browseros-mcp-port=%d", cfg.Ports.Server),
		fmt.Sprintf("--browseros-extension-port=%d", cfg.Ports.Extension),
		fmt.Sprintf("--user-data-dir=%s", cfg.UserDataDir),
	)

	if cfg.LoadDevExtensions {
		agentExtDir := filepath.Join(cfg.Root, "apps/app/dist/chrome-mv3-dev")
		args = append(args, fmt.Sprintf("--load-extension=%s", agentExtDir))
		if !cfg.DeferExtensionHome {
			if homeURL := devExtensionHomeURL(agentExtDir); homeURL != "" {
				args = append(args, homeURL)
			}
		}
	}

	return args
}

// devExtensionHomeURL opens the unpacked extension's declared new-tab page
// directly. BrowserOS reserves chrome://newtab for its native profile and
// rejects forcing that URL for this development profile.
func devExtensionHomeURL(extensionDir string) string {
	manifestBytes, err := os.ReadFile(filepath.Join(extensionDir, "manifest.json"))
	if err != nil {
		return ""
	}
	var manifest struct {
		Key                string `json:"key"`
		ChromeURLOverrides struct {
			NewTab string `json:"newtab"`
		} `json:"chrome_url_overrides"`
	}
	if json.Unmarshal(manifestBytes, &manifest) != nil || manifest.ChromeURLOverrides.NewTab == "" {
		return ""
	}
	id, ok := extensionIDFromKey(manifest.Key)
	if !ok {
		return ""
	}
	return fmt.Sprintf("chrome-extension://%s/%s#/home", id, strings.TrimLeft(manifest.ChromeURLOverrides.NewTab, "/"))
}

func extensionIDFromKey(key string) (string, bool) {
	der, err := base64.StdEncoding.DecodeString(key)
	if err != nil || len(der) == 0 {
		return "", false
	}
	sum := sha256.Sum256(der)
	const alphabet = "abcdefghijklmnop"
	var id strings.Builder
	id.Grow(32)
	for _, value := range sum[:16] {
		id.WriteByte(alphabet[value>>4])
		id.WriteByte(alphabet[value&0x0f])
	}
	return id.String(), true
}

func normalizeProduct(product string) string {
	if product == "" {
		return ProductBrowserOS
	}
	return product
}

func binaryExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
