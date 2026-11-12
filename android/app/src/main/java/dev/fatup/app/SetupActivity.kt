package dev.fatup.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.isVisible
import androidx.lifecycle.lifecycleScope
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import dev.fatup.app.databinding.ActivitySetupBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Launcher screen: pair with the server (QR or manual), then explains how to share. */
class SetupActivity : AppCompatActivity() {
    private lateinit var binding: ActivitySetupBinding
    private lateinit var config: Config

    private val scan = registerForActivityResult(ScanContract()) { result ->
        result.contents?.let(::applyLink)
    }

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySetupBinding.inflate(layoutInflater)
        setContentView(binding.root)
        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        config = Config(this)

        binding.scanButton.setOnClickListener {
            scan.launch(
                ScanOptions()
                    .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                    .setPrompt(getString(R.string.scan_prompt))
                    .setBeepEnabled(false)
                    .setOrientationLocked(false),
            )
        }
        binding.manualButton.setOnClickListener {
            binding.manualGroup.isVisible = !binding.manualGroup.isVisible
        }
        binding.saveButton.setOnClickListener {
            val url = SetupLink.normalizeServerUrl(binding.urlInput.text.toString())
            val token = binding.tokenInput.text.toString().trim()
            if (url == null || token.isEmpty()) {
                showStatus(getString(R.string.error_invalid_input), error = true)
            } else {
                connect(Connection(url, token))
            }
        }
        binding.testButton.setOnClickListener { config.connection?.let { connect(it, save = false) } }
        binding.disconnectButton.setOnClickListener {
            MaterialAlertDialogBuilder(this)
                .setTitle(R.string.disconnect)
                .setMessage(R.string.disconnect_confirm)
                .setNegativeButton(android.R.string.cancel, null)
                .setPositiveButton(R.string.disconnect) { _, _ ->
                    config.connection = null
                    render()
                }
                .show()
        }

        handleDeepLink(intent)
        render()
        askForNotifications()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleDeepLink(intent)
    }

    /** A phone camera app can open the QR's fatup:// link directly. */
    private fun handleDeepLink(intent: Intent?) {
        intent?.data?.toString()?.let(::applyLink)
    }

    private fun applyLink(raw: String) {
        val connection = SetupLink.parse(raw)
        if (connection == null) showStatus(getString(R.string.error_invalid_qr), error = true) else connect(connection)
    }

    private fun connect(connection: Connection, save: Boolean = true) {
        showStatus(getString(R.string.checking), error = false, busy = true)
        lifecycleScope.launch {
            val error = withContext(Dispatchers.IO) {
                runCatching { Api(connection).verify() }.exceptionOrNull()
            }
            if (error == null) {
                if (save) config.connection = connection
                render()
                showStatus(getString(R.string.connected_ok), error = false)
            } else {
                val message = if (error is ApiException && error.status == 401) getString(R.string.error_unauthorized) else getString(R.string.error_network)
                showStatus(message, error = true)
            }
        }
    }

    private fun render() {
        val connection = config.connection
        binding.connectedGroup.isVisible = connection != null
        binding.pairGroup.isVisible = connection == null
        binding.serverText.text = connection?.serverUrl
        binding.statusText.isVisible = false
        if (connection != null) binding.manualGroup.isVisible = false
    }

    private fun showStatus(text: String, error: Boolean, busy: Boolean = false) {
        binding.statusText.isVisible = true
        binding.statusText.text = text
        binding.statusText.setTextColor(
            ContextCompat.getColor(this, if (error) R.color.error else R.color.text_secondary),
        )
        binding.progress.visibility = if (busy) View.VISIBLE else View.GONE
    }

    private fun askForNotifications() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
