# Skynet plugin for Hyperion API

Install plugin (hpm - hyperion plugin manager)

```bash
# install from this repository
./hpm install -r https://github.com/guilledk/hyperion-skynet-plugin skynet-gpu
# enable the plugin globally
./hpm enable skynet-gpu
```

Required plugin config on chain.config.json

```json
{
  "plugins": {
    "skynet-gpu": {
      "debug": false,
      "contract": "telos.gpu",
      "actionIndex": "skynet-action",
      "deltaIndex": skynet-delta"
    }
  }
}
```
