const test = require("node:test");
const assert = require("node:assert/strict");
const { parseNutrition } = require("../cloudfunctions/recognizeNutrition/parse");

test("per 100g Chinese nutrition label converts kJ to kcal", () => {
  const result = parseNutrition([
    "营养成分表", "项目 每100克 NRV%", "能量 840千焦 10%",
    "蛋白质 10.5克 18%", "脂肪 3.2克 5%", "碳水化合物 30克 10%"
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.food.energy, 200.76);
  assert.equal(result.food.protein, 10.5);
  assert.equal(result.food.quantity, 100);
});

test("parenthesized gram units in a per 100g label are accepted", () => {
  const result = parseNutrition([
    "雪梨香蕉风味发酵乳 营养成分表", "项目 每100克(g) NRV%",
    "能量 363千焦(kJ) 4%", "蛋白质 3.2克(g) 5%",
    "脂肪 3.2克(g) 5%", "碳水化合物 10.9克(g) 4%"
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.food.energy, 86.76);
  assert.equal(result.food.protein, 3.2);
  assert.equal(result.food.fat, 3.2);
  assert.equal(result.food.carbs, 10.9);
});

test("per 100g header joined to NRV is accepted", () => {
  const cell = (DetectedText, X, Y) => ({
    DetectedText, ItemPolygon: { X, Y, Width: 80, Height: 22 }
  });
  const result = parseNutrition([
    cell("营养成分表", 235, 11),
    cell("大虾玉米馅饺子", 167, 49),
    cell("项目", 79, 62), cell("每100克NRV%", 161, 77),
    cell("能量", 53, 117), cell("642千焦", 164, 117),
    cell("蛋白质", 53, 149), cell("13.2克", 164, 149),
    cell("脂肪", 53, 179), cell("2.2克", 164, 179),
    cell("碳水化合物", 53, 240), cell("19.8克", 164, 240)
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.food.quantity, 100);
  assert.equal(result.food.measureUnit, "g");
  assert.equal(result.food.energy, 153.44);
  assert.equal(result.food.protein, 13.2);
  assert.equal(result.food.fat, 2.2);
  assert.equal(result.food.carbs, 19.8);
});

test("per-serving size accepts a parenthesized gram unit", () => {
  const result = parseNutrition([
    "每份25克(g)", "能量 100千卡", "蛋白质 2.5克",
    "脂肪 1克", "碳水化合物 18克"
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.food.servingSize, 25);
});

test("per-serving label preserves the stated values and nutrition basis", () => {
  const result = parseNutrition([
    { DetectedText: "每份(25g)" }, { DetectedText: "能量 100 kcal" },
    { DetectedText: "蛋白质 2.5 g" }, { DetectedText: "脂肪 1 g" },
    { DetectedText: "碳水化合物 18 g" }
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.food, {
    energy: 100, protein: 2.5, fat: 1, carbs: 18,
    servingSize: 25, coefficient: 1, quantity: 25, unit: "g", measureUnit: "g"
  });
});

test("per 100ml drink label keeps milliliters as the measurement unit", () => {
  const result = parseNutrition([
    "饮料营养成分表 项目 每100毫升(mL) NRV%",
    "能量 210千焦", "蛋白质 1.2克", "脂肪 0克", "碳水化合物 11.5克"
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.food.measureUnit, "ml");
  assert.equal(result.food.quantity, 100);
  assert.equal(result.food.energy, 50.19);
  assert.equal(result.food.carbs, 11.5);
});

test("per-serving milliliter drink label converts to per 100ml", () => {
  const result = parseNutrition([
    "每份 250mL", "能量 500kJ", "蛋白质 5g",
    "脂肪 2.5g", "碳水化合物 20g"
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.food.measureUnit, "ml");
  assert.equal(result.food.servingSize, 250);
  assert.equal(result.food.quantity, 250);
  assert.equal(result.food.protein, 5);
  assert.equal(result.food.fat, 2.5);
  assert.equal(result.food.carbs, 20);
});

test("per-bottle drink label is recognized in milliliters", () => {
  const result = parseNutrition([
    "每瓶 500ml", "能量 1000kJ", "蛋白质 0g",
    "脂肪 0g", "碳水化合物 50g"
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.food.measureUnit, "ml");
  assert.equal(result.food.quantity, 500);
  assert.equal(result.food.carbs, 50);
});

test("30g serving-size label ignores a separate per-100g product description", () => {
  const cell = (DetectedText, X, Y, Width = 90) => ({
    DetectedText, ItemPolygon: { X, Y, Width, Height: 24 }
  });
  const result = parseNutrition([
    cell("每100g", 80, 390), cell("产品中马铃薯平均使用量为385克", 200, 390),
    cell("营养成分表", 300, 710),
    cell("每份食用量: 30克", 90, 780),
    cell("项目", 120, 845), cell("每份", 450, 845),
    cell("能量", 120, 900), cell("蛋白质", 120, 960),
    cell("脂肪", 120, 1020), cell("碳水化合物", 120, 1080),
    cell("678千焦", 430, 900), cell("1.1克", 430, 960),
    cell("10.1克", 430, 1020), cell("16.8克", 430, 1080)
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.food.quantity, 30);
  assert.equal(result.food.servingSize, 30);
  assert.equal(result.food.energy, 162.05);
  assert.deepEqual(result.labelEnergy, { value: 678, unit: "kJ" });
  assert.equal(result.food.protein, 1.1);
  assert.equal(result.food.fat, 10.1);
  assert.equal(result.food.carbs, 16.8);
  assert.match(result.message, /每份30g/);
});

test("a per-100g product description is not a nutrition-table basis", () => {
  const result = parseNutrition([
    "每100g产品中马铃薯平均使用量为385克", "营养成分表", "每份食用量:30克",
    "项目 每份 营养素参考值%", "能量 678千焦", "蛋白质 1.1克",
    "脂肪 10.1克", "碳水化合物 16.8克"
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.food.quantity, 30);
});

test("a drink serving without an explicit ml amount is not guessed from net content", () => {
  const result = parseNutrition([
    "每份营养成分", "净含量 250ml", "能量 500kJ",
    "蛋白质 5g", "脂肪 2g", "碳水化合物 20g"
  ]);
  assert.equal(result.ok, false);
});

test("does not guess when serving size or energy unit is unknown", () => {
  assert.equal(parseNutrition(["每份", "能量 100kcal", "蛋白质 1g", "脂肪 1g", "碳水化合物 1g"]).ok, false);
  assert.equal(parseNutrition(["每100g", "能量 100", "蛋白质 1g", "脂肪 1g", "碳水化合物 1g"]).ok, false);
});

test("ignores saturated fat row and accepts wrapped label values", () => {
  const result = parseNutrition([
    "每100g", "饱和脂肪酸 1g", "能量(kJ)", "418.4", "脂肪 4g",
    "蛋白质 3g", "碳水化合物 10g"
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.food.energy, 100);
  assert.equal(result.food.fat, 4);
});

test("apple juice image with OCR grouped by table columns matches values by row", () => {
  const cell = (DetectedText, X, Y, Width = 70) => ({
    DetectedText, ItemPolygon: { X, Y, Width, Height: 20 }
  });
  const result = parseNutrition([
    cell("营养成分表", 220, 980),
    cell("项目", 60, 1010), cell("每100毫升", 250, 1010), cell("营养素参考值%", 410, 1010),
    cell("能量", 60, 1040), cell("蛋白质", 60, 1070), cell("脂肪", 60, 1100),
    cell("一饱和脂肪", 60, 1130), cell("碳水化合物", 60, 1160),
    cell("223千焦", 265, 1040), cell("0克", 285, 1070), cell("0克", 285, 1100),
    cell("0克", 285, 1130), cell("13.1克", 275, 1160),
    cell("3%", 510, 1040), cell("0%", 510, 1070), cell("0%", 510, 1100),
    cell("0%", 510, 1130), cell("4%", 510, 1160)
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.food.measureUnit, "ml");
  assert.equal(result.food.energy, 53.3);
  assert.equal(result.food.protein, 0);
  assert.equal(result.food.fat, 0);
  assert.equal(result.food.carbs, 13.1);
});

test("Tencent OCR's 干焦 typo on an energy row is treated as kJ", () => {
  const cell = (DetectedText, X, Y, Width = 70, Height = 18) => ({
    DetectedText, ItemPolygon: { X, Y, Width, Height }
  });
  const result = parseNutrition([
    cell("营养成分表", 251, 0, 102, 20),
    cell("项目", 60, 48, 33), cell("每100毫升", 254, 46, 77),
    cell("营养素参考值%", 426, 48, 107),
    cell("能量", 60, 93, 34), cell("223干焦", 263, 94, 68, 17), cell("3%", 506, 92, 26, 17),
    cell("蛋白质", 60, 124, 48), cell("0克", 300, 125),
    cell("脂肪", 60, 155, 34), cell("0克", 300, 156),
    cell("碳水化合物", 60, 217, 85), cell("13.1克", 280, 218)
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.food.energy, 53.3);
  assert.equal(result.food.measureUnit, "ml");
  assert.equal(result.food.protein, 0);
  assert.equal(result.food.fat, 0);
  assert.equal(result.food.carbs, 13.1);
  assert.deepEqual(result.labelEnergy, { value: 223, unit: "kJ" });
});

test("column OCR does not substitute NRV percentages for missing nutrition values", () => {
  const cell = (DetectedText, X, Y) => ({
    DetectedText, Polygon: [{ X, Y }, { X: X + 50, Y }, { X: X + 50, Y: Y + 20 }, { X, Y: Y + 20 }]
  });
  const result = parseNutrition([
    cell("每100毫升", 250, 100), cell("能量", 60, 140), cell("223千焦", 265, 140),
    cell("蛋白质", 60, 170), cell("脂肪", 60, 200), cell("碳水化合物", 60, 230),
    cell("0克", 265, 170), cell("0克", 265, 200),
    cell("3%", 500, 140), cell("0%", 500, 170), cell("0%", 500, 200), cell("4%", 500, 230)
  ]);
  assert.equal(result.ok, false);
  assert.match(result.message, /碳水化合物/);
  assert.doesNotMatch(result.message, /能量/);
});

test("column values shifted within their printed row still match", () => {
  const cell = (DetectedText, X, Y) => ({
    DetectedText, ItemPolygon: { X, Y, Width: 60, Height: 20 }
  });
  const result = parseNutrition([
    cell("每100毫升", 250, 100),
    cell("能量", 50, 150), cell("蛋白质", 50, 185),
    cell("脂肪", 50, 220), cell("碳水化合物", 50, 255),
    cell("223千焦", 260, 166), cell("0克", 260, 201),
    cell("0克", 260, 236), cell("13.1克", 260, 271)
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.food.carbs, 13.1);
});
