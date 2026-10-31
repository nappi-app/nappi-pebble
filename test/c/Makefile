# Host-side tests for the watch's plain-C logic. `make` builds and runs all.
CC ?= gcc
CFLAGS = -std=c99 -Wall -Wextra -Werror -pedantic -g -I../../src/c/logic -I.
LOGIC = $(wildcard ../../src/c/logic/*.c)
TESTS = $(wildcard test_*.c)
BINS = $(patsubst %.c,build/%,$(TESTS))

.PHONY: check clean
check: $(BINS)
	@fail=0; for t in $(BINS); do echo "== $$t"; $$t || fail=1; done; exit $$fail

build/%: %.c $(LOGIC) $(wildcard ../../src/c/logic/*.h) test.h
	@mkdir -p build
	@$(CC) $(CFLAGS) -o $@ $< $(LOGIC)

clean:
	rm -rf build
