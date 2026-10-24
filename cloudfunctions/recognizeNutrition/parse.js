const LABELS = {
  energy: /能\s*量|热\s*量/,
  protein: /蛋\s*白\s*质/,
  fat: /(?<!饱和)(?<!反式)脂\s*肪(?!\s*酸)/,
  carbs: /碳\s*水\s*化\s*合\s*物/
};

function round(value) {
  return Number(value.toFixed(2));
}

function extractLines(detections) {
  return (Array.isArray(detections) ? detections : [])
    .map((item) => {
      const text = String(item && (item.DetectedText || item) || "").normalize("NFKC").trim();
      const box = item && item.ItemPolygon;
      const points = item && item.Polygon;
      const xs = Array.isArray(points) ? points.map((point) => point.X) : [];
      const ys = Array.isArray(points) ? points.map((point) => point.Y) : [];
      const left = box && Number.isFinite(box.X) ? box.X : xs.length ? Math.min(...xs) : null;
      const right = box && Number.isFinite(box.X) && Number.isFinite(box.Width)
        ? box.X + box.Width : xs.length ? Math.max(...xs) : null;
      const top = box && Number.isFinite(box.Y) ? box.Y : ys.length ? Math.min(...ys) : null;
      const bottom = box && Number.isFinite(box.Y) && Number.isFinite(box.Height)
        ? box.Y + box.Height : ys.length ? Math.max(...ys) : null;
      return { text, left, right, centerY: top !== null && bottom !== null ? (top + bottom) / 2 : null,
        height: top !== null && bottom !== null ? bottom - top : null };
    })
    .filter((item) => item.text);
}

function servingSize(text) {
  const match = text.match(/(?:每\s*份(?:\s*食\s*用\s*量)?|每\s*包装|每\s*袋|每\s*瓶|每\s*罐|每\s*盒|每\s*杯)\s*[:：]?\s*[（(]?\s*(\d+(?:\.\d+)?)\s*(ml|毫升|l|升|kg|千克|g|克)(?=\s|[（()）,，;；]|$)/i);
  if (!match) return null;
  const unit = match[2].toLowerCase();
  return {
    amount: Number(match[1]) * (/^(kg|千克|l|升)$/.test(unit) ? 1000 : 1),
    measureUnit: /^(ml|毫升|l|升)$/.test(unit) ? "ml" : "g"
  };
}

function per100Basis(lines) {
  const titleIndex = lines.findIndex((line) => /营\s*养\s*成\s*分\s*表/.test(line.text));
  const title = lines[titleIndex];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (title && (line.centerY !== null && title.centerY !== null
      ? line.centerY < title.centerY : i < titleIndex)) continue;
    const match = line.text.match(/每\s*100\s*(ml|毫升|g|克)(?=\s|NRV|[（()）,，;；]|$)/i);
    if (match && !/产品中|平均使用量/.test(line.text)) return match;
  }
  return null;
}

function numericValue(candidate, key, context, requireUnit) {
  const match = candidate.match(/(\d+(?:\.\d+)?)\s*(kcal|千卡|大卡|kj|千焦|干焦|mg|毫克|g|克)?/i);
  if (!match || (candidate.includes("%") && !match[2])) return null;
  const unit = String(match[2] || "").toLowerCase();
  if (key === "energy") {
    if (unit && !/^(kj|千焦|干焦|kcal|千卡|大卡)$/.test(unit)) return null;
    const energyUnit = unit || (/千焦|干焦|\bkj\b/i.test(context) ? "kj" : /千卡|大卡|kcal/i.test(context) ? "kcal" : "");
    if (!energyUnit) return null;
    const sourceValue = Number(match[1]);
    const sourceUnit = /^(kj|千焦|干焦)$/.test(energyUnit) ? "kJ" : "kcal";
    return {
      value: sourceUnit === "kJ" ? sourceValue / 4.184 : sourceValue,
      sourceValue,
      sourceUnit
    };
  }
  if (/^(mg|毫克)$/.test(unit)) return Number(match[1]) / 1000;
  if (unit && !/^(g|克)$/.test(unit)) return null;
  if (requireUnit && !unit && !/(?:\bmg\b|毫克|\bg\b|克)/i.test(context)) return null;
  return Number(match[1]);
}

function rowValue(lines, key) {
  const label = LABELS[key];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = label.exec(line.text);
    if (!match) continue;
    const tail = line.text.slice(match.index + match[0].length);
    if (/\d/.test(tail)) {
      const value = numericValue(tail, key, line.text, false);
      if (value !== null) return value;
      continue;
    }
    if (line.centerY !== null) {
      const neighbors = lines.filter((item) => item.left !== null && item.centerY !== null
        && item.left >= line.right
        && Math.abs(item.centerY - line.centerY) <= Math.max(12, Math.min(18, Math.min(line.height, item.height) * 0.9)))
        .sort((a, b) => a.left - b.left);
      for (const neighbor of neighbors) {
        const value = numericValue(neighbor.text, key, `${line.text} ${neighbor.text}`, true);
        if (value !== null) return value;
      }
    } else {
      const next = lines[i + 1];
      const value = next && numericValue(next.text, key, `${line.text} ${next.text}`, false);
      if (value !== null) return value;
    }
  }
  return null;
}

function parseNutrition(detections) {
  const lines = extractLines(detections);
  const text = lines.map((line) => line.text).join(" ");
  const per100 = per100Basis(lines);
  const perServing = /每\s*份|每\s*包装|每\s*袋|每\s*瓶|每\s*罐|每\s*盒|每\s*杯/.test(text);
  const size = servingSize(text);
  const measureUnit = per100
    ? /^(ml|毫升)$/i.test(per100[1]) ? "ml" : "g"
    : size && size.measureUnit;
  if (!per100 && !perServing) {
    return { ok: false, message: "未识别到每100g、每100ml或每份的计量基准，请重新拍摄清晰的营养成分表" };
  }
  if (!per100 && !size) {
    return { ok: false, message: "识别到每份营养值，但未识别到每份的克数或毫升数，无法安全换算" };
  }

  const labelEnergy = rowValue(lines, "energy");
  const values = {
    energy: labelEnergy && labelEnergy.value,
    protein: rowValue(lines, "protein"),
    fat: rowValue(lines, "fat"),
    carbs: rowValue(lines, "carbs")
  };
  const missing = Object.entries(values)
    .filter(([, value]) => value === null || !Number.isFinite(value))
    .map(([key]) => ({ energy: "能量", protein: "蛋白质", fat: "脂肪", carbs: "碳水化合物" })[key]);
  if (missing.length) {
    return { ok: false, message: `未识别完整：${missing.join("、")}。请选择清晰原图或手动填写` };
  }
  const multiplier = per100 ? 1 : 100 / size.amount;
  if ([values.protein, values.fat, values.carbs].some((value) => value * multiplier > 100) || values.energy * multiplier > 2000) {
    return { ok: false, message: "识别出的营养数值超出合理范围，请重新拍摄或手动填写" };
  }
  return {
    ok: true,
    food: {
      energy: round(values.energy),
      protein: round(values.protein),
      fat: round(values.fat),
      carbs: round(values.carbs),
      servingSize: size ? size.amount : 0,
      coefficient: 1,
      quantity: per100 ? 100 : size.amount,
      unit: measureUnit,
      measureUnit
    },
    labelEnergy: { value: labelEnergy.sourceValue, unit: labelEnergy.sourceUnit },
    message: `已按${per100 ? `每100${measureUnit}` : `每份${size.amount}${measureUnit}`}识别，请核对数值、规格及食物名称后保存`
  };
}

module.exports = { parseNutrition };
