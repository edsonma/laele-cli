BIN := laele

.PHONY: build test install dist clean web-install web-dev web-test web-build docker-run

build:
	go build -o $(BIN) .

test:
	go vet .
	go test .

install: build
	install -d $(HOME)/.local/bin
	install -m 755 $(BIN) $(HOME)/.local/bin/$(BIN)

dist:
	@for t in linux/amd64 linux/arm64 darwin/amd64 darwin/arm64; do \
		os=$${t%/*}; arch=$${t#*/}; \
		CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch go build -o dist/$(BIN)-$$os-$$arch . || exit 1; \
	done

clean:
	rm -rf $(BIN) dist

# --- web version (see web/) ---

web-install:
	cd web && npm ci

web-dev:
	cd web && npm run dev

web-test:
	cd web && npm test && npm run typecheck

web-build:
	cd web && npm run build

# Build and run the same container Railway uses, at http://localhost:8080
docker-run:
	docker build -t laele-web .
	docker run --rm -e PORT=8080 -p 8080:8080 laele-web
