import js from '@eslint/js';

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: { process: 'readonly', console: 'readonly', fetch: 'readonly' },
        },
    },
];
