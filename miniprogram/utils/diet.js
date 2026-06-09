const kcalToKj = (kcal) => kcal * 4.184;
const round = (value) => Math.round(Number(value) || 0);
const formatDecimal = (value, digits = 1) => (Number(value) || 0).toFixed(digits);
const clampPercent = (value, total) => Math.min(100, Math.max(0, total ? (value / total) * 100 : 0));

const defaultProfile = {
  sex: "male",
  weight: 75,
  height: 180,
  age: 28,
  plan: "gain"
};

const defaultFoods = [
  { name: "米饭（蒸）", carbs: 28.2, protein: 2.6, fat: 0.3, coefficient: 1, quantity: 150, unit: "g" },
  { name: "鸡胸肉（煎）", carbs: 0, protein: 31, fat: 3.6, coefficient: 1, quantity: 120, unit: "g" },
  { name: "牛肉（炒）", carbs: 6.1, protein: 25.7, fat: 10.2, coefficient: 1, quantity: 120, unit: "g" },
  { name: "西兰花（炒）", carbs: 3.6, protein: 2.6, fat: 1, coefficient: 1, quantity: 200, unit: "g" },
  { name: "鸡蛋（水煮）", carbs: 0.6, protein: 6.3, fat: 5, coefficient: 50, quantity: 1, unit: "个" },
  { name: "香蕉", carbs: 22.8, protein: 1.2, fat: 0.3, coefficient: 1, quantity: 120, unit: "g" }
];

function getStorage(key, fallback) {
  try {
    const value = wx.getStorageSync(key);
    return value === "" || value === undefined ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function setStorage(key, value) {
  wx.setStorageSync(key, value);
}

function pad2(value) {
  return value < 10 ? `0${value}` : String(value);
}

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  return `${year}-${month}-${day}`;
}

function formatDateTime(value) {
  const timestamp = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return `${dateKey(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function parseDateKey(key) {
  const parts = String(key).split("-").map(Number);
  return new Date(parts[0] || 1970, (parts[1] || 1) - 1, parts[2] || 1);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function readEnergyUnit() {
  return getStorage("dietEnergyUnit", "kcal");
}

function energyValue(kcal, unit = readEnergyUnit()) {
  return unit === "kJ" ? kcalToKj(kcal) : kcal;
}

function formatEnergy(kcal, unit = readEnergyUnit()) {
  return `${round(energyValue(kcal, unit))} ${unit}`;
}

function readProfile() {
  return { ...defaultProfile, ...(getStorage("dietProfile", {}) || {}) };
}

function saveProfile(profile) {
  setStorage("dietProfile", profile);
}

function foodSignature(food) {
  const name = String(food.name || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  const unit = String(food.unit || "g")
    .normalize("NFKC")
    .trim()
    .toLowerCase();
  return [
    name,
    unit
  ].join("|");
}

function isCountUnit(unit) {
  return String(unit || "").trim() === "个";
}

function normalizeFood(food, index = 0) {
  const image = String(food.image || "");
  const normalized = {
    id: food.id || `food-${Date.now()}-${index}`,
    name: String(food.name || "未命名食物"),
    carbs: Number(food.carbs || 0),
    protein: Number(food.protein || 0),
    fat: Number(food.fat || 0),
    coefficient: Number(food.coefficient || 1),
    quantity: Number(food.quantity || 100),
    unit: String(food.unit || "g").trim() || "g",
    image: image.length > 500 ? "" : image
  };
  normalized.signature = foodSignature(normalized);
  return normalized;
}

function readFoodCatalog() {
  const foods = getStorage("dietFoodCatalog", null) || getStorage("dietFoods", null);
  if (Array.isArray(foods)) return dedupeFoods(foods);
  return defaultFoods.map(normalizeFood);
}

function saveFoodCatalog(foods) {
  const normalized = dedupeFoods(foods);
  setStorage("dietFoodCatalog", normalized);
  setStorage("dietFoods", normalized);
}

function dedupeFoods(foods) {
  const seen = new Set();
  return (Array.isArray(foods) ? foods : [])
    .map(normalizeFood)
    .filter((food) => {
      if (seen.has(food.signature)) return false;
      seen.add(food.signature);
      return true;
    })
    .slice(0, 500);
}

function sortFoodsByUsage(foods, history = readDailyMealHistory()) {
  const usage = {};
  Object.keys(history || {}).sort().forEach((key) => {
    const meals = Array.isArray(history[key]) ? history[key] : [];
    meals.forEach((meal) => {
      if (!meal || !meal.food) return;
      const signature = foodSignature(meal.food);
      const current = usage[signature] || { count: 0, lastUsed: "" };
      current.count += 1;
      if (key > current.lastUsed) current.lastUsed = key;
      usage[signature] = current;
    });
  });

  return (Array.isArray(foods) ? foods : [])
    .map((food, index) => ({
      food,
      index,
      usage: usage[foodSignature(food)] || { count: 0, lastUsed: "" }
    }))
    .sort((left, right) => (
      right.usage.count - left.usage.count ||
      right.usage.lastUsed.localeCompare(left.usage.lastUsed) ||
      left.index - right.index
    ))
    .map((item) => item.food);
}

function normalizeTodayMeal(meal, index = 0) {
  if (!meal || !meal.food) return null;
  const quantity = Number(meal.quantity !== undefined ? meal.quantity : meal.food.quantity);
  const consumedAt = Number(meal.consumedAt || 0);
  return {
    id: meal.id || `meal-${Date.now()}-${index}`,
    quantity: Number.isFinite(quantity) ? quantity : 100,
    consumedAt: Number.isFinite(consumedAt) && consumedAt > 0 ? consumedAt : 0,
    food: normalizeFood(meal.food, index)
  };
}

function readTodayMeals() {
  const today = dateKey();
  const history = readDailyMealHistory();
  if (Object.prototype.hasOwnProperty.call(history, today)) {
    return history[today];
  }

  const storedDate = getStorage("dietTodayMealsDate", "");
  const meals = getStorage("dietTodayMeals", []);
  if (storedDate === today && Array.isArray(meals)) {
    return meals.map(normalizeTodayMeal).filter(Boolean);
  }

  setStorage("dietTodayMeals", []);
  setStorage("dietTodayMealsDate", today);
  return [];
}

function readDailyMealHistory() {
  const history = getStorage("dietDailyMeals", {});
  if (!history || typeof history !== "object" || Array.isArray(history)) return {};
  const normalized = {};
  Object.keys(history).forEach((key) => {
    const meals = history[key];
    normalized[key] = Array.isArray(meals) ? meals.map(normalizeTodayMeal).filter(Boolean) : [];
  });
  return normalized;
}

function saveDailyMealHistory(history) {
  const normalized = {};
  Object.keys(history || {}).forEach((key) => {
    const meals = history[key];
    normalized[key] = Array.isArray(meals) ? meals.map(normalizeTodayMeal).filter(Boolean) : [];
  });
  setStorage("dietDailyMeals", normalized);
  saveDailySummaries(buildDailySummaries(normalized));
}

function syncTodayMealsToHistory(meals) {
  const history = readDailyMealHistory();
  history[dateKey()] = meals.map(normalizeTodayMeal).filter(Boolean);
  saveDailyMealHistory(history);
}

function saveTodayMeals(meals) {
  const normalized = meals.map(normalizeTodayMeal).filter(Boolean);
  setStorage("dietTodayMeals", normalized);
  setStorage("dietTodayMealsDate", dateKey());
  syncTodayMealsToHistory(normalized);
}

function calculateTargets(profile = readProfile()) {
  const sexAdjustment = profile.sex === "female" ? -161 : 5;
  const a = Number(profile.weight) * 9.99 + Number(profile.height) * 6.25 - Number(profile.age) * 4.92 + sexAdjustment;
  const b = a / 0.7;
  const e1 = b + 200;
  const e2 = b;
  const factor = profile.plan === "loss" ? 0.64 : 0.84;
  return { a, b, e1, e2, f1: e1 * factor, f2: e2 * factor };
}

function macroTargets(calories) {
  return {
    carbs: calories * 0.5 / 4,
    protein: calories * 0.3 / 4,
    fat: calories * 0.2 / 9
  };
}

function foodServingGrams(food) {
  if (isCountUnit(food.unit)) return Number(food.quantity || 0);
  return Number(food.quantity || 0) * Number(food.coefficient || 1);
}

function formatServingAmount(food) {
  const countUnit = isCountUnit(food.unit);
  const amount = countUnit ? Number(food.quantity || 0) : foodServingGrams(food);
  const value = Number.isInteger(amount) ? amount : Number(amount.toFixed(2));
  return `${value}${countUnit ? "个" : "g"}`;
}

function formatUnitGrams(food) {
  const grams = Number(food.coefficient || 1);
  const value = Number.isInteger(grams) ? grams : Number(grams.toFixed(1));
  return `${value}g`;
}

function foodScale(food) {
  if (isCountUnit(food.unit)) return Number(food.quantity || 0);
  return Number(food.quantity || 0) * Number(food.coefficient || 1) / 100;
}

function foodMacros(food) {
  const scale = foodScale(food);
  return {
    carbs: Number(food.carbs || 0) * scale,
    protein: Number(food.protein || 0) * scale,
    fat: Number(food.fat || 0) * scale
  };
}

function foodEnergyPer100g(food) {
  return Number(food.carbs || 0) * 4 + Number(food.protein || 0) * 4 + Number(food.fat || 0) * 9;
}

function foodReferenceEnergyLabel(food) {
  return isCountUnit(food.unit) ? "每个" : "每100g";
}

function foodEnergy(food) {
  const macros = foodMacros(food);
  return macros.carbs * 4 + macros.protein * 4 + macros.fat * 9;
}

function mealFood(meal) {
  const quantity = Number(meal.quantity !== undefined ? meal.quantity : meal.food.quantity);
  return { ...meal.food, quantity: Number.isFinite(quantity) ? quantity : 0 };
}

function totalIntake(meals = readTodayMeals()) {
  return meals.reduce((sum, meal) => {
    const food = mealFood(meal);
    const macros = foodMacros(food);
    sum.kcal += foodEnergy(food);
    sum.carbs += macros.carbs;
    sum.protein += macros.protein;
    sum.fat += macros.fat;
    return sum;
  }, { kcal: 0, carbs: 0, protein: 0, fat: 0 });
}

function buildDailySummary(meals) {
  const intake = totalIntake(Array.isArray(meals) ? meals : []);
  return {
    kcal: intake.kcal,
    carbs: intake.carbs,
    protein: intake.protein,
    fat: intake.fat,
    mealCount: Array.isArray(meals) ? meals.length : 0
  };
}

function buildDailySummaries(history = readDailyMealHistory()) {
  const summaries = {};
  Object.keys(history || {}).forEach((key) => {
    summaries[key] = buildDailySummary(history[key]);
  });
  return summaries;
}

function readDailySummaries() {
  const summaries = getStorage("dietDailySummaries", {});
  return summaries && typeof summaries === "object" && !Array.isArray(summaries) ? summaries : {};
}

function saveDailySummaries(summaries) {
  setStorage("dietDailySummaries", summaries && typeof summaries === "object" ? summaries : {});
}

module.exports = {
  addDays,
  buildDailySummaries,
  buildDailySummary,
  calculateTargets,
  clampPercent,
  dateKey,
  dedupeFoods,
  energyValue,
  foodEnergy,
  foodEnergyPer100g,
  foodMacros,
  foodReferenceEnergyLabel,
  foodServingGrams,
  foodSignature,
  formatDecimal,
  formatDateTime,
  formatEnergy,
  formatServingAmount,
  formatUnitGrams,
  isCountUnit,
  macroTargets,
  mealFood,
  normalizeFood,
  normalizeTodayMeal,
  parseDateKey,
  readDailyMealHistory,
  readDailySummaries,
  readEnergyUnit,
  readFoodCatalog,
  readProfile,
  readTodayMeals,
  round,
  saveFoodCatalog,
  saveDailyMealHistory,
  saveDailySummaries,
  saveProfile,
  saveTodayMeals,
  setStorage,
  sortFoodsByUsage,
  syncTodayMealsToHistory,
  totalIntake
};
