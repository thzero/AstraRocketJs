#!/bin/bash

cd web
npm run build:inc
cd..
source ./push.sh "%1"