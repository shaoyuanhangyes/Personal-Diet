const cloud = require("wx-server-sdk");
const tencentcloud = require("tencentcloud-sdk-nodejs-ocr");
const { parseNutrition } = require("./parse");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event = {}) => {
  const context = cloud.getWXContext();
  if (!context.OPENID) return { ok: false, message: "请先登录后再识别" };
  const fileID = String(event.fileID || "");
  if (!/^cloud:\/\/.+\/diet-nutrition-labels\/[\w-]+\.(jpg|jpeg|png|bmp)$/i.test(fileID)) {
    return { ok: false, message: "营养成分表图片无效" };
  }
  try {
    const file = await cloud.downloadFile({ fileID });
    const buffer = file && file.fileContent;
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 7 * 1024 * 1024) {
      return { ok: false, message: "图片大小不符合要求，请使用小于7MB的照片" };
    }
    const client = new tencentcloud.ocr.v20181119.Client({
      credential: {
        secretId: process.env.TENCENTCLOUD_SECRETID,
        secretKey: process.env.TENCENTCLOUD_SECRETKEY,
        token: process.env.TENCENTCLOUD_SESSIONTOKEN
      },
      region: process.env.TENCENTCLOUD_REGION || "ap-guangzhou",
      profile: { httpProfile: { endpoint: "ocr.tencentcloudapi.com" } }
    });
    const result = await client.GeneralBasicOCR({ ImageBase64: buffer.toString("base64") });
    return parseNutrition(result && result.TextDetections);
  } catch (error) {
    console.error("nutrition OCR failed", error);
    return {
      ok: false,
      message: "识别服务暂不可用，请稍后重试或手动填写",
      errorCode: error && (error.code || error.name) || "UnknownError"
    };
  }
};
