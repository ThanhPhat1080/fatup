package dev.fatup.app

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

class Notifications(private val context: Context) {
    private val manager = NotificationManagerCompat.from(context)

    init {
        val channel = NotificationChannel(CHANNEL, context.getString(R.string.channel_uploads), NotificationManager.IMPORTANCE_LOW)
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun builder() = NotificationCompat.Builder(context, CHANNEL)
        .setSmallIcon(R.drawable.ic_stat_upload)
        .setColor(ContextCompat.getColor(context, R.color.brand))

    fun progress(index: Int, total: Int, name: String?, fraction: Float): Notification =
        builder()
            .setContentTitle(if (total > 0) context.getString(R.string.sending_progress, index.coerceAtLeast(1), total) else context.getString(R.string.sending))
            .setContentText(name)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setProgress(100, (fraction * 100).toInt().coerceIn(0, 100), total == 0)
            .build()

    fun update(id: Int, notification: Notification) = notify(id, notification)

    fun finished(sent: Int, failedNames: List<String>) {
        val n = builder().setAutoCancel(true)
        if (failedNames.isEmpty()) {
            n.setContentTitle(context.resources.getQuantityString(R.plurals.sent_files, sent, sent))
        } else {
            n.setContentTitle(context.resources.getQuantityString(R.plurals.send_failed, failedNames.size, failedNames.size))
                .setContentText(failedNames.joinToString(", "))
                .setStyle(NotificationCompat.BigTextStyle().bigText(failedNames.joinToString("\n")))
        }
        notify(RESULT_ID, n.build())
    }

    fun failed(message: String) {
        notify(RESULT_ID, builder().setContentTitle(context.getString(R.string.send_failed_title)).setContentText(message).setAutoCancel(true).build())
    }

    private fun notify(id: Int, notification: Notification) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED ||
            android.os.Build.VERSION.SDK_INT < 33
        ) {
            manager.notify(id, notification)
        }
    }

    companion object {
        const val CHANNEL = "uploads"
        private const val RESULT_ID = 1001
    }
}
