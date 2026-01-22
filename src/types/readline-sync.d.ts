declare module "readline-sync" {
  export function question(query?: string, options?: any): string;
  export function prompt(options?: any): string;
  export function keyInSelect(items: string[], query?: string, options?: any): number;
  export function keyInYN(query?: string, options?: any): boolean | string;
  export function keyIn(query?: string, options?: any): string;
  export function questionEMail(query?: string, options?: any): string;
  export function questionNewPassword(query?: string, options?: any): string;
  export function questionInt(query?: string, options?: any): number;
  export function questionFloat(query?: string, options?: any): number;
  export function questionPath(query?: string, options?: any): string;
}
