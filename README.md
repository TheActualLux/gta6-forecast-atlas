# GTA VI trophy-rarity forecaster

[![make.fun · gta6-trophy-rarity-forecast-01](https://make.fun/badge/gta6-trophy-rarity-forecast-01.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![rank](https://make.fun/badge/gta6-trophy-rarity-forecast-01/TheActualLux/gta6-forecast-atlas/rank.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![reward](https://make.fun/badge/gta6-trophy-rarity-forecast-01/TheActualLux/gta6-forecast-atlas/reward.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)

A forecast of every Grand Theft Auto VI PlayStation 5 trophy's earn rate on Exophase a week after launch, entered in [make.fun](https://make.fun)'s trophy-rarity bounty.

Each trophy's rate is pulled partway toward its tier's mature earn rate over the horizon, in logit space; when the case's history spans six hours, a shrunk least-squares logit trend is added. Uncertainty grows with elapsed time and with the size of the assumed movement, and the five quantiles are the pinball-loss forecast the competition scores.

## Run it

    MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

Node 22.18 or later, standard library only, no network.

Reference: [make.fun](https://make.fun).
