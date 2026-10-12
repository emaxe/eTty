package com.etty.mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * REQ-19 (задача #29): пустая foreground-служба — единственная задача — не дать Android убить
 * процесс, пока Dart-сторона ([ForegroundService.start]/`stop`, `terminal_page.dart`) считает,
 * что есть активное SSH-соединение. Сама не трогает сеть/PTY — этим занимается dartssh2 в том же
 * процессе; служба только держит foreground-приоритет через постоянную нотификацию.
 *
 * `START_NOT_STICKY`: если систему всё же убьёт и она попытается перезапустить службу без intent,
 * не поднимаем её заново — источник истины "нужна ли служба" на стороне Dart (активно ли
 * SSH-соединение), а не у самой службы.
 */
class TerminalForegroundService : Service() {
    companion object {
        private const val CHANNEL_ID = "etty_ssh_connection"
        private const val NOTIFICATION_ID = 1001
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForegroundCompat()
        return START_NOT_STICKY
    }

    private fun startForegroundCompat() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            val channel = NotificationChannel(
                CHANNEL_ID,
                "SSH-соединение",
                NotificationManager.IMPORTANCE_LOW,
            ).apply { description = "Активное SSH-соединение eTty" }
            manager.createNotificationChannel(channel)
        }

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("eTty")
            .setContentText("SSH-соединение активно в фоне")
            .setSmallIcon(applicationInfo.icon)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }
}
