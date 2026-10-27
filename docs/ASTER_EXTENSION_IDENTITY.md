# Aster extension identity and release configuration

Aster development builds use the stable public key embedded in the manifest identity helper. Its Chrome extension ID is `oifdmombnijnaiocijiacjhajbnpdlhb`. The key is public and does not let a developer sign or publish an update. Development builds have no update URL. Their `externally_connectable` declaration has an empty ID allowlist, and they have no `web_accessible_resources`; this keeps extension-to-extension messages and web-page access closed by default.

The emitted-manifest regression test builds the app through WXT into a disposable directory under the system temp folder, then reads the emitted development manifest. Run it from `packages/browseros-agent/apps/app`:

```sh
ASTER_RUN_MANIFEST_INTEGRATION=1 JITI_FS_CACHE=false bun test lib/build/aster-manifest-integration.test.ts
```

The test is opt-in because it performs a full WXT build; ordinary app test runs skip it. `JITI_FS_CACHE=false` avoids a Jiti cache permission failure when a prior build cache was created by another user. The build defaults to a 4 GiB Node heap when `NODE_OPTIONS` is unset, removes inherited `ASTER_*` and Sentry upload credentials, and deletes its temporary output after reading the manifest. A second short WXT invocation checks that a public key without its paired update URL is rejected.

## Headed runtime smoke

Use the repeatable S05 smoke with a disposable headed browser and local server in the same network namespace:

```sh
nsenter --target "$BROWSER_PID" --user --net --preserve-credentials \
  python packages/browseros-agent/scripts/dev/aster_identity_smoke.py \
  --cdp-port 9483 --server-port 9079 \
  --probe-extension-id lbjfbofbmfdabocciedikbkmkijpmkih \
  --expect-reporter deny
```

For the explicit reporter-allow case, build with the fixture ID configured and run the same command with `--expect-reporter allow`. The smoke checks the emitted runtime manifest, a fresh internal diagnostics response, the fixture's external diagnostics request, the guarded providers API, and allowed/denied Origin statuses. It prints only boolean results, extension identity, and HTTP status codes.

After rebuilding with a different reporter configuration, load the build in a fresh disposable profile before running the allow case. The headed browser can retain an older MV3 service worker after the on-disk manifest changes; the smoke checks the active worker source and fails with an explicit stale-worker message if the configured reporter ID is not loaded.

## Release configuration

Release jobs must set these environment variables together:

- `ASTER_EXTENSION_PUBLIC_KEY`: the base64 encoded DER SubjectPublicKeyInfo for the Aster extension signing identity.
- `ASTER_EXTENSION_UPDATE_URL`: an absolute HTTPS URL for the Aster-owned update manifest. Credentials in the URL and BrowserOS hosts are rejected.

Optional integration values are separately gated:

- `ASTER_REPORTER_EXTENSION_ID`: one explicit, non-BrowserOS Chrome extension ID allowed to connect to the Aster extension. The default is an empty allowlist.
- `ASTER_PRODUCT_WEB_URL`: an HTTPS origin used to generate the product site's web-accessible resource matches. A BrowserOS host, localhost, IP address, credentials, port, path, query, or fragment is rejected.
- `ASTER_COMPAT_EXTENSION_ID`: an explicit non-BrowserOS extension ID allowed to fetch the product resource. It requires `ASTER_PRODUCT_WEB_URL` and is emitted only as part of that resource declaration.

The local server's default `BROWSEROS_TRUSTED_ORIGINS` policy trusts the stable Aster development extension ID. A release using a different public key must also configure the server with `BROWSEROS_TRUSTED_ORIGINS=chrome-extension://<derived-release-ID>`. BrowserOS extension IDs are not implicitly trusted; retain upstream compatibility only through an intentional, explicit allowlist entry. The origin policy rejects disallowed explicit Origin headers, while some loopback GET routes accept originless requests; this is not authentication against another local process.

Do not set the compatibility ID or product origin merely to make an integration work. Review each caller and resource against the intended feature, and keep the values absent when that integration is not part of the release. The code validates shape and rejects known BrowserOS identifiers; those checks do not prove that Aster owns or controls any domain, key, update service, or reporter deployment.

## Release ownership and custody gates

Before distributing a release, the release owner must document and verify outside this repository that:

- the private signing key was generated and is held in an approved, access-controlled release system, with backup, rotation, and incident procedures;
- the public key maps to the ID intended for the release, and only authorized release automation can sign with the corresponding private key;
- the update host and manifest are controlled by Aster, served over HTTPS, protected against unauthorized publication, and tested with a signed update;
- every product origin and reporter extension ID is controlled by the Aster team responsible for that integration, with a documented owner and change process;
- the final packaged manifest contains only the approved update, connection, and web-resource entries, and no BrowserOS identity or feed.

An HTTPS URL, a syntactically valid extension ID, or a successful build is not ownership evidence. This document and the automated manifest checks do not establish custody or domain control. Do not create or store release private keys in this repository. Release key custody, verified infrastructure ownership, and packaged release review remain distribution blockers until their evidence is recorded by the release owner.
