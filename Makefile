SHELL := /bin/zsh

.PHONY: setup build doctor download run test dashboard-install dashboard-agent dashboard-web dashboard-build

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
