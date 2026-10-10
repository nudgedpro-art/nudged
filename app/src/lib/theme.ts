// The post-it look from nudged.pro, as plain values for StyleSheet.
export const C = {
  board: "#e4e6df",
  ink: "#2a2f2b",
  muted: "#6b7268",
  paper: "#fff176",
  need: "#ffab91",
  cal: "#b3e5fc",
  card: "#f6f7f3",
  btn: "#2a2f2b",
  btnInk: "#f6f7f3",
  danger: "#b23a2e",
  line: "rgba(42,47,43,0.18)",
};

export const F = {
  title: { fontSize: 28, fontWeight: "700" as const, color: C.ink },
  h2: { fontSize: 20, fontWeight: "700" as const, color: C.ink },
  body: { fontSize: 16, lineHeight: 23, color: C.ink },
  small: { fontSize: 13, lineHeight: 18, color: C.muted },
  tag: { fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase" as const, color: "#6f6438", fontWeight: "600" as const },
};
