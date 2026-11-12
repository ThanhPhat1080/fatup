package dev.fatup.app

import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.SystemClock
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Uploads every file of one share batch, one after another. */
class UploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    private val notifications = Notifications(context)
    private val notificationId = params.id.hashCode()
    private var lastNotify = 0L

    override suspend fun getForegroundInfo(): ForegroundInfo = foreground(0, 0, null, 0f)

    private fun foreground(index: Int, total: Int, name: String?, fraction: Float): ForegroundInfo {
        val n = notifications.progress(index, total, name, fraction)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(notificationId, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(notificationId, n)
        }
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val batchFile = File(inputData.getString(KEY_BATCH) ?: return@withContext Result.failure())
        var batch = Batch.load(batchFile) ?: return@withContext Result.failure()
        val connection = Config(applicationContext).connection
        if (connection == null) {
            notifications.failed(applicationContext.getString(R.string.error_not_configured))
            cleanup(batch, batchFile)
            return@withContext Result.failure()
        }
        val api = Api(connection)
        val device = Config(applicationContext).deviceName
        runCatching { setForeground(foreground(batch.done, batch.total, null, 0f)) }

        while (true) {
            val index = batch.nextPending ?: break
            val entry = batch.entries[index]
            try {
                upload(api, entry, device) { sent ->
                    val now = SystemClock.elapsedRealtime()
                    if (now - lastNotify > 700) {
                        lastNotify = now
                        notifications.update(notificationId, notifications.progress(index + 1, batch.total, entry.name, sent.toFloat() / entry.size.coerceAtLeast(1)))
                    }
                }
                File(entry.path).delete()
                batch = batch.with(index, Entry.State.DONE)
                batch.save(batchFile)
            } catch (e: ApiException) {
                if (e.status == 401) {
                    notifications.failed(applicationContext.getString(R.string.error_unauthorized))
                    cleanup(batch, batchFile)
                    return@withContext Result.failure()
                }
                if (!e.permanent && runAttemptCount < MAX_ATTEMPTS) return@withContext Result.retry()
                File(entry.path).delete()
                batch = batch.with(index, Entry.State.FAILED)
                batch.save(batchFile)
            } catch (e: IOException) {
                if (runAttemptCount < MAX_ATTEMPTS) return@withContext Result.retry()
                File(entry.path).delete()
                batch = batch.with(index, Entry.State.FAILED)
                batch.save(batchFile)
            }
        }

        notifications.finished(batch.done, batch.failed.map { it.name })
        cleanup(batch, batchFile)
        Result.success()
    }

    private fun upload(api: Api, entry: Entry, device: String, onProgress: (Long) -> Unit) {
        val file = File(entry.path)
        if (!file.exists()) throw ApiException("File missing", 400, permanent = true)

        val thumb = File(file.path + ".thumb.jpg")
        val hasThumb = isImage(entry.mime) && (thumb.exists() || Thumbnails.create(file, thumb))
        try {
            val ticket = api.createUpload(entry.name, entry.mime, file.length(), hasThumb, device)
            api.putFile(ticket.uploadUrl, file, entry.mime, onProgress)
            if (hasThumb && ticket.thumbUploadUrl != null) {
                // A missing preview is not worth failing the upload for.
                runCatching { api.putFile(ticket.thumbUploadUrl, thumb, "image/jpeg") }
            }
            api.complete(ticket.id)
        } finally {
            if (!file.exists() || hasThumb) thumb.delete()
        }
    }

    private fun cleanup(batch: Batch, batchFile: File) {
        batch.entries.forEach { File(it.path).delete(); File(it.path + ".thumb.jpg").delete() }
        batchFile.delete()
    }

    companion object {
        private const val KEY_BATCH = "batch"
        private const val MAX_ATTEMPTS = 8

        fun enqueue(context: Context, batchFile: File) {
            val request = OneTimeWorkRequestBuilder<UploadWorker>()
                .setInputData(workDataOf(KEY_BATCH to batchFile.absolutePath))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .addTag("upload")
                .build()
            WorkManager.getInstance(context).enqueue(request)
        }
    }
}
