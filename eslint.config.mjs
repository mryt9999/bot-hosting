import globals from "globals";

export default [
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
            globals: {
                ...globals.node,
            }
        },
        rules: {
            "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
            "no-console": "off",
            "prefer-const": "warn",
            "no-var": "error",
            "eqeqeq": ["warn", "always"],
            "curly": ["warn", "all"],
            "no-duplicate-imports": "error",
            "no-unreachable": "error",
            "semi": ["warn", "always"],
            "quotes": ["warn", "single", { "avoidEscape": true }],
            "indent": ["warn", 4],
            "no-trailing-spaces": "warn",
            "comma-dangle": ["warn", "only-multiline"],
            "object-curly-spacing": ["warn", "always"],
            "arrow-spacing": "warn",
            "keyword-spacing": "warn",
            "space-before-blocks": "warn",
        }
    }
];
