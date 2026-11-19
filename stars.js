export const starColors = ['#ffe16b','#ff932d'];
export const starPoints = Array.from({length:10}, (_,i) => {
  const a = Math.PI/2+i*Math.PI/5, r = i%2 ? .44 : 1;
  return [Math.cos(a)*r,Math.sin(a)*r];
});

export function starPulse(seconds, index) {
  const age = seconds % 6 - .50 - index*.095;
  if (age <= 0 || age >= 1) return 0;
  return Math.min(1,age/.18,(1-age)/.30);
}
