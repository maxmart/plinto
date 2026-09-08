import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * The source directory of an plinto package, found by resolving one of its
 * published entry points. Not a relative "../../packages/…" path: that spells
 * out where the monorepo happens to keep the package today, and is wrong the
 * moment this example is cloned on its own and the packages come from npm.
 */
const plintoSrc = (entry) => path.dirname(require.resolve(entry));

const adminSrc = plintoSrc('@plinto/admin/host');
const astroSrc = plintoSrc('@plinto/astro/config');

/** @type {import('tailwindcss').Config} */
const config = {
  content: [
    './src/**/*.{astro,js,ts,jsx,tsx,mdx}',
    // The admin's stylesheet is this build; @plinto/admin is where the admin
    // UI lives, so its source has to be scanned or the classes only it uses
    // are silently dropped. @plinto/astro contributes the route shells and
    // islands around it.
    `${adminSrc}/**/*.{astro,js,ts,jsx,tsx}`,
    `${astroSrc}/**/*.{astro,js,ts,jsx,tsx}`,
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [],
};
export default config;
