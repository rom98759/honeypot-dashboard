// simpleheat ships no type declarations. Minimal ambient typing for the surface AttackMap.tsx uses.
declare module "simpleheat" {
  export default function simpleheat(canvas: HTMLCanvasElement | string): {
    data(data: Array<[number, number, number]>): unknown;
    max(max: number): unknown;
    gradient(colors: Record<number, string>): unknown;
    draw(minOpacity?: number): unknown;
  };
}
