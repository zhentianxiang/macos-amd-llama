SHELL := /bin/zsh

.PHONY: setup build doctor download run embedding test dashboard-install dashboard-agent dashboard-web dashboard-build dashboard-start

setup:
	./scripts/setup.sh

build:
	./scripts/build.sh

doctor:
	./scripts/doctor.sh

download:
	./scripts/download-model.sh

run:
	./scripts/run.sh

embedding:
	./scripts/run-embedding.sh

test:
	./scripts/test-api.sh

dashboard-install:
	cd dashboard && npm ci --cache .npm-cache

dashboard-agent:
	./scripts/dashboard-agent.sh

dashboard-web:
	./scripts/dashboard-web.sh

dashboard-build:
	cd dashboard && npm run build

dashboard-start:
	./scripts/dashboard-start.sh
