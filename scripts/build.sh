#!/usr/bin/env bash

# For now, just need to copy spectre to public
mkdir -p ./public/css && cp ./node_modules/spectre.css/dist/spectre.min.css ./public/css/spectre.css
mkdir -p ./public/js && cp ./js/index.js ./public/js/index.js
