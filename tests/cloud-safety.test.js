const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..", "miniprogram");

function loadCloudFunction(name, { openid = "user-a", readError = null } = {}) {
  const writes = [];
  const reads = [];
  const documents = new Map();
  let transactionQueue = Promise.resolve();
  const db = {
    createCollection: async () => {},
    serverDate: () => new Date(),
    runTransaction(run) {
      const pending = transactionQueue.then(() => run({
        collection(name) {
          return {
            doc(id) {
              return {
                async get() {
                  reads.push({ collection: name, id });
                  if (readError) throw readError;
                  return { data: documents.get(`${name}/${id}`) || null };
                },
                async set({ data }) {
                  writes.push({ collection: name, id, data });
                  documents.set(`${name}/${id}`, data);
                }
              };
            }
          };
        }
      }));
      transactionQueue = pending.catch(() => {});
      return pending;
    },
    collection(collection) {
      return {
        where(query) {
          return {
            limit() {
              return {
                async get() {
                  reads.push({ collection, id: query._id });
                  if (readError) throw readError;
                  const value = documents.get(`${collection}/${query._id}`);
                  return { data: value ? [value] : [] };
                }
              };
            }
          };
        },
        doc(id) {
          return {
            async set({ data }) {
              writes.push({ collection, id, data });
              documents.set(`${collection}/${id}`, data);
            },
            async remove() {
              writes.push({ collection, id, remove: true });
            }
          };
        }
      };
    }
  };
  const cloud = {
    DYNAMIC_CURRENT_ENV: "test",
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: openid })
  };
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(root, "cloudfunctions", name, "index.js"), "utf8");
  vm.runInNewContext(source, {
    require: (id) => id === "wx-server-sdk" ? cloud : require(id),
    exports: module.exports,
    module,
    Date,
    Promise,
    Number,
    String,
    Array,
    Object,
    Set,
    Map,
    Error
  });
  return { main: module.exports.main, writes, reads, documents };
}

test("cloud functions reject a client-supplied openid without a trusted identity", async () => {
  for (const name of ["getDietData", "syncDietData"]) {
    const service = loadCloudFunction(name, { openid: "" });
    await assert.rejects(service.main({ openid: "victim" }), /missing openid/);
    assert.equal(service.reads.length, 0);
    assert.equal(service.writes.length, 0);
  }
});

test("cloud reads use the caller identity and propagate database errors", async () => {
  for (const name of ["getDietData", "syncDietData"]) {
    const service = loadCloudFunction(name, { readError: new Error("database unavailable") });
    await assert.rejects(service.main({ openid: "victim" }), /database unavailable/);
    assert.ok(service.reads.every((read) => read.id !== "victim"));
    assert.equal(service.writes.length, 0);
  }
});

test("a new user's missing documents still allow initial synchronization", async () => {
  const service = loadCloudFunction("syncDietData");
  await service.main({ todayDate: "2026-10-22", todayMeals: [], dailyMeals: {} });
  assert.ok(service.writes.some((write) => write.collection === "diet_user_profiles" && write.id === "user-a"));
  assert.ok(service.writes.some((write) => write.collection === "diet_daily_meals" && write.id === "user-a"));
});

test("cloud sync preserves summary-only dates and recalculates dates with meals", async () => {
  const service = loadCloudFunction("syncDietData");
  const meal = {
    quantity: 100,
    food: { unit: "g", coefficient: 1, energy: 120, carbs: 20, protein: 5, fat: 2 }
  };
  service.documents.set("diet_daily_meals/user-a", {
    dailyMeals: { "2026-10-19": [meal] },
    dailySummaries: {
      "2026-10-20": { kcal: 350, carbs: 20, protein: 10, fat: 20, mealCount: 2 }
    }
  });
  await service.main({
    todayDate: "2026-10-22",
    todayMeals: [meal],
    dailyMeals: { "2026-10-19": [] },
    dailySummaries: {
      "2026-10-20": { kcal: 999, carbs: 0, protein: 0, fat: 0, mealCount: 1 },
      "2026-10-21": { kcal: 500, carbs: 50, protein: 25, fat: 15, mealCount: 3 },
      "2026-10-22": { kcal: 999, carbs: 0, protein: 0, fat: 0, mealCount: 1 }
    }
  });
  const saved = service.documents.get("diet_daily_meals/user-a").dailySummaries;
  assert.equal(service.documents.get("diet_daily_meals/user-a").dailyMeals["2026-10-19"].length, 1);
  assert.equal(saved["2026-10-19"].kcal, 120);
  assert.equal(saved["2026-10-20"].kcal, 350);
  assert.equal(saved["2026-10-21"].kcal, 500);
  assert.equal(saved["2026-10-22"].kcal, 120);
});

test("calendar-only sync preserves cloud meals and does not overwrite profile or foods", async () => {
  const service = loadCloudFunction("syncDietData");
  const remoteMeal = { id: "remote", quantity: 100, food: { unit: "g", coefficient: 1, energy: 120 } };
  service.documents.set("diet_daily_meals/user-a", {
    dailyMeals: { "2026-10-20": [remoteMeal] },
    dailySummaries: { "2026-10-20": { kcal: 120, mealCount: 1 } }
  });
  await service.main({
    syncScope: "calendar",
    dailyMeals: { "2026-10-20": [], "2026-10-21": [] },
    dailySummaries: { "2026-10-21": { kcal: 350, carbs: 20, protein: 10, fat: 20, mealCount: 2 } }
  });
  assert.deepEqual(service.writes.map(({ collection }) => collection), ["diet_daily_meals"]);
  const saved = service.documents.get("diet_daily_meals/user-a");
  assert.equal(saved.dailyMeals["2026-10-20"].length, 1);
  assert.equal(saved.dailySummaries["2026-10-20"].kcal, 120);
  assert.equal(saved.dailySummaries["2026-10-21"].kcal, 350);
});

test("an explicitly dirty historical date replaces the old cloud meal", async () => {
  const service = loadCloudFunction("syncDietData");
  const date = "2026-10-20";
  const remote = { id: "remote", quantity: 100, food: { unit: "g", coefficient: 1, energy: 120 } };
  const local = { id: "local", quantity: 100, food: { unit: "g", coefficient: 1, energy: 220 } };
  service.documents.set("diet_daily_meals/user-a", {
    dailyMeals: { [date]: [remote] },
    dailySummaries: { [date]: { kcal: 120, mealCount: 1 } }
  });
  await service.main({
    syncScope: "calendar",
    dailyMeals: { [date]: [local] },
    overwriteDates: [date]
  });
  const saved = service.documents.get("diet_daily_meals/user-a");
  assert.equal(saved.dailyMeals[date][0].id, "local");
  assert.equal(saved.dailySummaries[date].kcal, 220);
});

test("concurrent syncs of different dates retain both records", async () => {
  const service = loadCloudFunction("syncDietData");
  const meal = { quantity: 100, food: { unit: "g", coefficient: 1, energy: 120 } };
  await Promise.all(["2026-10-20", "2026-10-21"].map((date) => service.main({
    syncScope: "calendar",
    dailyMeals: { [date]: [meal] },
    overwriteDates: [date]
  })));
  const saved = service.documents.get("diet_daily_meals/user-a");
  assert.equal(saved.dailyMeals["2026-10-20"].length, 1);
  assert.equal(saved.dailyMeals["2026-10-21"].length, 1);
});

test("failed cloud hydration does not upload local data", async () => {
  const storage = new Map();
  const calls = [];
  global.getApp = () => ({ globalData: { cloudReady: true } });
  global.wx = {
    login: ({ success }) => success({ code: "test-code" }),
    getStorageSync: (key) => storage.get(key) || "",
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    cloud: {
      callFunction: ({ name }) => {
        calls.push(name);
        if (name === "login") return Promise.resolve({ result: { openid: "user-a" } });
        if (name === "getDietData") return Promise.reject(new Error("database unavailable"));
        return Promise.resolve({ result: { ok: true } });
      }
    }
  };
  const sync = require("../miniprogram/utils/cloud-sync");
  await assert.rejects(sync.loginWithWechat(), /database unavailable/);
  assert.deepEqual(calls, ["login", "getDietData"]);
  assert.equal(sync.getStoredUser(), null);
});

test("non-finite meal quantities are rejected", () => {
  let page;
  global.Page = (definition) => { page = definition; };
  require("../miniprogram/pages/today-meals/today-meals.js");
  for (const value of ["NaN", "Infinity", "-Infinity"]) {
    const state = {
      data: { foods: [{ name: "test" }], selectedIndex: 0, quantity: value },
      setData(patch) { Object.assign(this.data, patch); }
    };
    page.addMeal.call(state);
    assert.equal(state.data.status, "数量需要大于 0");
  }
});
