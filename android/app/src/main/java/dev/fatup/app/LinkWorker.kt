package dev.fatup.app

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Sends one shared link to the server, retrying while the network is down. */
class LinkWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val url = inputData.getString(KEY_URL) ?: return@withContext Result.failure()
        val title = inputData.getString(KEY_TITLE)
        val notifications = Notifications(applicationContext)
        val config = Config(applicationContext)
        val connection = config.connection
        if (connection == null) {
            notifications.failed(applicationContext.getString(R.string.error_not_configured))
            return@withContext Result.failure()
        }
        try {
            Api(connection).createLink(url, title, config.deviceName)
            Result.success()
        } catch (e: ApiException) {
            if (e.status == 401) {
                notifications.failed(applicationContext.getString(R.string.error_unauthorized))
                Result.failure()
            } else if (!e.permanent && runAttemptCount < MAX_ATTEMPTS) {
                Result.retry()
            } else {
                notifications.failed(applicationContext.getString(R.string.link_send_failed, url))
                Result.failure()
            }
        } catch (e: IOException) {
            if (runAttemptCount < MAX_ATTEMPTS) {
                Result.retry()
            } else {
                notifications.failed(applicationContext.getString(R.string.link_send_failed, url))
                Result.failure()
            }
        }
    }

    companion object {
        private const val KEY_URL = "url"
        private const val KEY_TITLE = "title"
        private const val MAX_ATTEMPTS = 8

        fun enqueue(context: Context, url: String, title: String?) {
            val request = OneTimeWorkRequestBuilder<LinkWorker>()
                .setInputData(workDataOf(KEY_URL to url, KEY_TITLE to title))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
                .addTag("link")
                .build()
            WorkManager.getInstance(context).enqueue(request)
        }
    }
}
