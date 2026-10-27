package browser

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"
)

type cdpTarget struct {
	Type string `json:"type"`
	URL  string `json:"url"`
}

// OpenDevExtensionHome waits for the unpacked extension worker to register,
// then opens its home page through CDP. Opening the extension URL as a
// Chromium startup argument races extension registration on Linux and can
// leave an ERR_BLOCKED_BY_CLIENT interstitial in the first tab.
func OpenDevExtensionHome(ctx context.Context, port int, root string) error {
	extensionDir := filepath.Join(root, "apps/app/dist/chrome-mv3-dev")
	homeURL := devExtensionHomeURL(extensionDir)
	if homeURL == "" {
		return errors.New("could not determine development extension home URL from manifest")
	}
	client := &http.Client{Timeout: 2 * time.Second}
	baseURL := fmt.Sprintf("http://127.0.0.1:%d", port)
	return waitAndOpenDevExtensionHome(ctx, client, baseURL, homeURL)
}

func waitAndOpenDevExtensionHome(ctx context.Context, client *http.Client, baseURL, homeURL string) error {
	parsedHome, err := url.Parse(homeURL)
	if err != nil || parsedHome.Scheme != "chrome-extension" || parsedHome.Host == "" {
		return fmt.Errorf("invalid development extension URL %q", homeURL)
	}
	workerPrefix := "chrome-extension://" + parsedHome.Host + "/"
	deadline := time.NewTimer(30 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()

	for {
		request, requestErr := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/json/list", nil)
		if requestErr != nil {
			return requestErr
		}
		response, requestErr := client.Do(request)
		if requestErr == nil {
			var targets []cdpTarget
			if response.StatusCode == http.StatusOK {
				requestErr = json.NewDecoder(response.Body).Decode(&targets)
			}
			response.Body.Close()
			if requestErr == nil {
				for _, target := range targets {
					if target.Type == "service_worker" && strings.HasPrefix(target.URL, workerPrefix) {
						openURL := baseURL + "/json/new?" + url.QueryEscape(homeURL)
						openRequest, err := http.NewRequestWithContext(ctx, http.MethodPut, openURL, nil)
						if err != nil {
							return err
						}
						openResponse, err := client.Do(openRequest)
						if err != nil {
							return fmt.Errorf("open development extension home: %w", err)
						}
						openResponse.Body.Close()
						if openResponse.StatusCode < 200 || openResponse.StatusCode >= 300 {
							return fmt.Errorf("open development extension home: CDP returned %s", openResponse.Status)
						}
						return nil
					}
				}
			}
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deadline.C:
			return fmt.Errorf("timed out waiting for extension worker %s", workerPrefix)
		case <-ticker.C:
		}
	}
}
