/**
 * Join Tailwind class names, letting the later one win.
 *
 * `clsx` flattens the conditionals; `twMerge` resolves the collisions, so a
 * component's own `px-4` gives way to a caller's `px-2` instead of the pair
 * landing in the class list and the cascade deciding by stylesheet order.
 *
 * (This lived in `lib/utils.ts`, a filename that says nothing about the one
 * function in it.)
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
