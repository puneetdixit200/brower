package browser

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func TestWaitAndOpenDevExtensionHomeOpensAfterWorkerRegistration(t *testing.T) {
	const homeURL = "chrome-extension://asterextensionid/app.html#/home"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/json/list":
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `[{"type":"service_worker","url":"chrome-extension://asterextensionid/background.js"}]`)
		case "/json/new":
			if r.Method != http.MethodPut {
				t.Errorf("open method = %s, want PUT", r.Method)
			}
			decoded, err := url.QueryUnescape(r.URL.RawQuery)
			if err != nil || decoded != homeURL {
				t.Errorf("open query = %q, want %q (err %v)", decoded, homeURL, err)
			}
			w.WriteHeader(http.StatusOK)
		default:
			t.Errorf("unexpected CDP path %q", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := waitAndOpenDevExtensionHome(ctx, server.Client(), server.URL, homeURL); err != nil {
		t.Fatal(err)
	}
}
