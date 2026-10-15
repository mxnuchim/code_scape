import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The 3D world drives Three.js objects imperatively (useFrame, instanced
    // buffers, shader uniforms), the idiomatic React Three Fiber pattern. The
    // React Compiler purity rules don't model that, and this project doesn't
    // use the compiler, so they're off for the world folder only.
    files: ["src/components/world/**"],
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "dist/**", "test/fixtures/**", "next-env.d.ts"]),
]);

export default eslintConfig;
