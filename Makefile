.PHONY: build run stop logs dev test clean

build:
	docker build -t renplay:latest .

run:
	mkdir -p games data
	docker run -d --name renplay -p 8080:8080 -v $(PWD)/games:/games -v $(PWD)/data:/data renplay:latest
	@echo "Running at http://localhost:8080"

stop:
	docker rm -f renplay

logs:
	docker logs -f renplay

dev:
	docker compose up --build

test:
	cd server && npm test
	cd selector && npx tsc -b --noEmit

clean:
	docker rm -f renplay 2>/dev/null || true
	rm -rf selector/dist server/dist
