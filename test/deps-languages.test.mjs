import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildDeps, readsFile } from "../server/deps.mjs";

async function repo(t, files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-skyline-langs-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [p, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, p)), { recursive: true });
    await writeFile(path.join(dir, p), text);
  }
  return { dir, paths: Object.keys(files).sort() };
}

const edgesOf = async (t, files) => {
  const { dir, paths } = await repo(t, files);
  return buildDeps(dir, paths).edges.map(([a, b]) => `${a} -> ${b}`).sort();
};

test("Go: imports of repo packages by the names used, and files of one package by shared names", async (t) => {
  const edges = await edgesOf(t, {
    "go.mod": "module github.com/x/app\n\ngo 1.22\n",
    "internal/paths/paths.go": 'package paths\n\nfunc Home() string { return "" }\n',
    "internal/paths/extra.go": 'package paths\n\nconst (\n\tSep = "/"\n\tunused = 1\n)\n',
    "internal/paths/paths_test.go": 'package paths\n\nimport "testing"\n\nfunc TestHome(t *testing.T) { _ = Home() }\n',
    "internal/run/run.go":
      'package run\n\nimport (\n\t"fmt"\n\tp "github.com/x/app/internal/paths"\n)\n\n// p.Sep in a comment\nfunc Run() { fmt.Println(p.Home()) }\n',
    "cmd/app/main.go": 'package main\n\nimport "github.com/x/app/internal/run"\n\nfunc main() { run.Run() }\n',
  });
  assert.deepEqual(edges, [
    "cmd/app/main.go -> internal/run/run.go",
    "internal/paths/paths_test.go -> internal/paths/paths.go",
    "internal/run/run.go -> internal/paths/paths.go",
  ]);
});

test("Python: absolute imports from any source root, relative imports, submodules by name", async (t) => {
  const edges = await edgesOf(t, {
    "src/app/__init__.py": "",
    "src/app/core.py": "def run(): pass\n",
    "src/app/logging.py": "import logging\n",
    "src/app/util/__init__.py": "from .text import slug\n",
    "src/app/util/text.py": "def slug(s): return s\n",
    "src/app/main.py": 'from app import core\nfrom .util import text\nimport app.util\n"""import app.logging"""\n',
    "tests/test_core.py": "from app.core import run\n",
  });
  assert.deepEqual(edges, [
    "src/app/main.py -> src/app/core.py",
    "src/app/main.py -> src/app/util/__init__.py",
    "src/app/main.py -> src/app/util/text.py",
    "src/app/util/__init__.py -> src/app/util/text.py",
    "tests/test_core.py -> src/app/core.py",
  ]);
});

test("Java/Kotlin: same package, single and wildcard imports, static imports, across languages", async (t) => {
  const edges = await edgesOf(t, {
    "src/main/java/com/x/model/User.java": "package com.x.model;\npublic class User { }\n",
    "src/main/java/com/x/model/Role.java": "package com.x.model;\npublic enum Role { ADMIN; User owner; }\n",
    "src/main/java/com/x/util/Strings.java":
      "package com.x.util;\npublic final class Strings { public static String trim(String s) { return s; } }\n",
    "src/main/java/com/x/api/Users.java":
      "package com.x.api;\nimport com.x.model.*;\nimport static com.x.util.Strings.trim;\npublic class Users { User u; }\n",
    "src/main/kotlin/com/x/api/Format.kt": 'package com.x.api\nimport com.x.model.User as Person\nfun format(p: Person) = ""\n',
    "src/test/kotlin/com/x/api/UsersTest.kt": "package com.x.api\nclass UsersTest { val u = Users(); val s = format(null) }\n",
  });
  assert.deepEqual(edges, [
    "src/main/java/com/x/api/Users.java -> src/main/java/com/x/model/User.java",
    "src/main/java/com/x/api/Users.java -> src/main/java/com/x/util/Strings.java",
    "src/main/java/com/x/model/Role.java -> src/main/java/com/x/model/User.java",
    "src/main/kotlin/com/x/api/Format.kt -> src/main/java/com/x/model/User.java",
    "src/test/kotlin/com/x/api/UsersTest.kt -> src/main/java/com/x/api/Users.java",
    "src/test/kotlin/com/x/api/UsersTest.kt -> src/main/kotlin/com/x/api/Format.kt",
  ]);
});

test("C/C++: quoted includes next to the file or by path tail; system headers ignored", async (t) => {
  const edges = await edgesOf(t, {
    "include/net/http.h": "#pragma once\n",
    "src/net/http.c": '#include "net/http.h"\n#include <stdio.h>\n',
    "src/main.c": '#include "util.h"\n/* #include "net/http.h" */\n',
    "src/util.h": "int f(void);\n",
  });
  assert.deepEqual(edges, ["src/main.c -> src/util.h", "src/net/http.c -> include/net/http.h"]);
});

test("Rust: mod declarations, crate/self/super paths, grouped uses, other workspace crates", async (t) => {
  const edges = await edgesOf(t, {
    "Cargo.toml": '[package]\nname = "app"\n',
    "src/main.rs":
      "mod net;\nmod util;\nuse crate::net::{http::Client, tcp};\nfn main() { let s: &'static str = \"crate::util\"; }\n",
    "src/net/mod.rs": "pub mod http;\npub mod tcp;\n",
    "src/net/http.rs": "use super::tcp::Socket;\npub struct Client;\n",
    "src/net/tcp.rs": "pub struct Socket;\n",
    "src/util.rs": "pub fn f() {}\n",
    "core/Cargo.toml": '[package]\nname = "app-core"\n',
    "core/src/lib.rs": "pub mod model;\n",
    "core/src/model.rs": "pub struct Thing;\n",
    "src/uses_core.rs": "use app_core::model::Thing;\n",
  });
  assert.deepEqual(edges, [
    "core/src/lib.rs -> core/src/model.rs",
    "src/main.rs -> src/net/http.rs",
    "src/main.rs -> src/net/mod.rs",
    "src/main.rs -> src/net/tcp.rs",
    "src/main.rs -> src/util.rs",
    "src/net/http.rs -> src/net/tcp.rs",
    "src/net/mod.rs -> src/net/http.rs",
    "src/net/mod.rs -> src/net/tcp.rs",
    "src/uses_core.rs -> core/src/model.rs",
  ]);
});

test("PHP: namespaces, use (renamed and grouped), fully qualified names, require", async (t) => {
  const edges = await edgesOf(t, {
    "src/Model/User.php": "<?php\nnamespace App\\Model;\nclass User {}\n",
    "src/Model/Role.php": "<?php\nnamespace App\\Model;\nenum Role { case Admin; }\n",
    "src/Http/Controller.php":
      "<?php\nnamespace App\\Http;\nuse App\\Model\\{User, Role as R};\nclass Controller { function f(User $u, R $r) {} }\n",
    "src/Http/Legacy.php": "<?php\nrequire_once __DIR__ . '/../helpers.php';\n$u = new \\App\\Model\\User();\n",
    "src/helpers.php": "<?php\nfunction h() {}\n",
  });
  assert.deepEqual(edges, [
    "src/Http/Controller.php -> src/Model/Role.php",
    "src/Http/Controller.php -> src/Model/User.php",
    "src/Http/Legacy.php -> src/Model/User.php",
    "src/Http/Legacy.php -> src/helpers.php",
  ]);
});

test("Ruby: require_relative, require by path tail, constants for autoloaded code", async (t) => {
  const edges = await edgesOf(t, {
    "lib/shop/cart.rb": "module Shop\n  class Cart\n  end\nend\n",
    "lib/shop.rb": "require_relative 'shop/cart'\n",
    "app/models/order.rb": 'class Order\n  # Cart is only in a comment here\n  def items = "Cart"\nend\n',
    "app/services/checkout.rb": "class Checkout\n  def run = Order.new\nend\n",
    "spec/cart_spec.rb": "require 'shop/cart'\n",
  });
  assert.deepEqual(edges, [
    "app/services/checkout.rb -> app/models/order.rb",
    "lib/shop.rb -> lib/shop/cart.rb",
    "spec/cart_spec.rb -> lib/shop/cart.rb",
  ]);
});

test("Swift: files of a module use the types they name", async (t) => {
  const edges = await edgesOf(t, {
    "Sources/App/User.swift": "struct User { let name: String }\n",
    "Sources/App/Store.swift": "final class Store { var users: [User] = [] }\n",
    "Tests/AppTests/StoreTests.swift": "import XCTest\n@testable import App\nfinal class StoreTests: XCTestCase { let s = Store() }\n",
  });
  assert.deepEqual(edges, [
    "Sources/App/Store.swift -> Sources/App/User.swift",
    "Tests/AppTests/StoreTests.swift -> Sources/App/Store.swift",
  ]);
});

test("readsFile covers every supported language and the config files they need", () => {
  for (const p of ["a.go", "go.mod", "a.py", "A.java", "a.kt", "a.cpp", "a.h", "a.rs", "Cargo.toml", "a.php", "a.rb", "a.swift", "a.cs", "a.ts", "tsconfig.json"])
    assert.equal(readsFile(p), true, p);
  assert.equal(readsFile("README.md"), false);
});
