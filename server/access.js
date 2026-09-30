import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function createAccess({
  origin = "",
  secret = randomBytes(32).toString("hex"),
} = {}) {
  const allowed = new Set(
    origin
      .split(",")
      .filter(Boolean)
      .map((value) => new URL(value.trim()).origin),
  );
  const sign = (value) =>
    createHmac("sha256", secret).update(value).digest("hex");
  return {
    allowsOrigin(value) {
      if (!value) return true;
      if (allowed.size) return allowed.has(value);
      return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(value);
    },
    visitor(req, res) {
      if (!allowed.size) return "local";
      const cookie =
        /(?:^|;\s*)bg_session=([a-f0-9]{32})\.([a-f0-9]{64})(?:;|$)/.exec(
          req.headers.cookie || "",
        );
      if (
        cookie &&
        timingSafeEqual(
          Buffer.from(cookie[2], "hex"),
          Buffer.from(sign(cookie[1]), "hex"),
        )
      )
        return cookie[1];
      const id = randomBytes(16).toString("hex");
      res.setHeader(
        "Set-Cookie",
        `bg_session=${id}.${sign(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${[...allowed].some((value) => value.startsWith("https:")) ? "; Secure" : ""}`,
      );
      return id;
    },
  };
}
