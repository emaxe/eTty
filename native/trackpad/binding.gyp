{
  "targets": [
    {
      "target_name": "trackpad",
      "sources": ["trackpad.cc"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include_dir\")"],
      "defines": ["NAPI_VERSION=8", "NAPI_CPP_EXCEPTIONS"],
      "cflags_cc": ["-std=c++17", "-fexceptions"],
      "conditions": [
        ["OS=='mac'", {
          "xcode_settings": {
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "MACOSX_DEPLOYMENT_TARGET": "11.0"
          },
          "link_settings": { "libraries": ["-framework CoreFoundation"] }
        }]
      ]
    }
  ]
}
