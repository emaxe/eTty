package com.etty.mobile

import android.content.Intent
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * REQ-19 (задача #29): мост Dart (`lib/platform/foreground_service.dart`) <->
 * [TerminalForegroundService] — канал симметричен `start`/`stop`, активность ничего не знает про
 * SSH/жизненный цикл соединения, только транслирует вызовы в системный `Service`.
 *
 * `FlutterFragmentActivity`, а не `FlutterActivity`: `local_auth` (REQ-18, биометрическая
 * блокировка) на Android требует `FragmentActivity`, иначе `authenticate()` падает и войти нельзя.
 */
class MainActivity : FlutterFragmentActivity() {
    private val channelName = "com.etty.mobile/foreground_service"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "start" -> {
                        startService(Intent(this, TerminalForegroundService::class.java))
                        result.success(null)
                    }
                    "stop" -> {
                        stopService(Intent(this, TerminalForegroundService::class.java))
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }
    }
}
