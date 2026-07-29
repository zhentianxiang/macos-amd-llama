SHELL := /bin/zsh

.PHONY: setup build doctor download run test

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
