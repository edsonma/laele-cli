BIN := laele

.PHONY: build test install dist clean

build:
	go build -o $(BIN) .

test:
	go vet ./...
	go test ./...

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
