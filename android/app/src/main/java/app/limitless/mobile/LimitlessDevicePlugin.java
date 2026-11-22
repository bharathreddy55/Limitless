package app.limitless.mobile;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@CapacitorPlugin(name = "LimitlessDevice")
public class LimitlessDevicePlugin extends Plugin {
    private static final String CONFIG = "telegram_config";
    private static final String SESSION = "telegram_session";
    private static final long CACHE_TTL = 24L * 60L * 60L * 1000L;
    private static final int CHUNK_BYTES = 256 * 1024;
    private final Map<String, Transfer> transfers = new ConcurrentHashMap<>();
    private SessionVault vault;

    private static final class Transfer {
        final File file;
        final String mime;
        final long size;

        Transfer(File file, String mime, long size) {
            this.file = file;
            this.mime = mime;
            this.size = size;
        }
    }

    @Override
    public void load() {
        vault = new SessionVault(getContext());
    }

    @PluginMethod
    public void status(PluginCall call) {
        boolean configured;
        try {
            configured = vault.read(CONFIG) != null;
        } catch (Exception error) {
            configured = false;
        }
        JSObject status = new JSObject();
        status.put("configured", configured);
        status.put("savedSession", configured && vault.contains(SESSION));
        call.resolve(status);
    }

    @PluginMethod
    public void configure(PluginCall call) {
        Integer id = call.getInt("apiId");
        String hash = call.getString("apiHash", "");
        if (id == null || id <= 0 || !hash.matches("[a-fA-F0-9]{32}")) {
            call.reject("The Android setup file is invalid.");
            return;
        }
        try {
            JSObject config = new JSObject();
            config.put("apiId", id);
            config.put("apiHash", hash);
            vault.remove(SESSION);
            vault.save(CONFIG, config.toString());
            call.resolve();
        } catch (Exception error) {
            call.reject("Android could not save the setup in its encrypted storage.");
        }
    }

    @PluginMethod
    public void readConfig(PluginCall call) {
        try {
            String config = vault.read(CONFIG);
            if (config == null) call.reject("Choose the Android setup file first.");
            else call.resolve(new JSObject(config));
        } catch (Exception error) {
            call.reject("Android could not read the saved setup. Import the setup file again.");
        }
    }

    @PluginMethod
    public void readSession(PluginCall call) {
        try {
            JSObject data = new JSObject();
            data.put("session", vault.read(SESSION));
            call.resolve(data);
        } catch (Exception error) {
            call.reject("Android could not read the saved sign-in.");
        }
    }

    @PluginMethod
    public void saveSession(PluginCall call) {
        String session = call.getString("session", "");
        if (session.isEmpty() || session.length() > 16384) {
            call.reject("The Telegram session could not be saved.");
            return;
        }
        try {
            vault.save(SESSION, session);
            call.resolve();
        } catch (Exception error) {
            call.reject("Android could not save the sign-in in its encrypted storage.");
        }
    }

    @PluginMethod
    public void clearSession(PluginCall call) {
        try {
            vault.remove(SESSION);
            call.resolve();
        } catch (IOException error) {
            call.reject("Android could not clear its encrypted session.");
        }
    }

    @PluginMethod
    public void beginFile(PluginCall call) {
        long size;
        try {
            size = Long.parseLong(call.getString("size", ""));
            if (size < 0) throw new NumberFormatException();
        } catch (NumberFormatException error) {
            call.reject("Invalid file size.");
            return;
        }

        String name = call.getString("name", "").replaceAll("[\\\\/\\p{Cntrl}]", "_").trim();
        if (name.isEmpty() || name.equals(".") || name.equals("..")) name = "limitless-file";
        if (name.length() > 110) {
            int extension = name.lastIndexOf('.');
            name = name.substring(0, 90) + (extension > 90 && name.length() - extension <= 20 ? name.substring(extension) : "");
        }
        String mime = call.getString("mime", "");
        if (!mime.matches("[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+")) mime = "application/octet-stream";

        File root = new File(getContext().getCacheDir(), "limitless-transfer");
        cleanCache(root);
        String key = UUID.randomUUID().toString();
        File folder = new File(root, key);
        File file = new File(folder, name);
        try {
            if (!folder.mkdirs() || !file.createNewFile()) throw new IOException();
            transfers.put(key, new Transfer(file, mime, size));
            JSObject result = new JSObject();
            result.put("key", key);
            call.resolve(result);
        } catch (IOException error) {
            removeFolder(folder);
            call.reject("Android could not prepare the file. Check the available storage.");
        }
    }

    @PluginMethod
    public void appendFile(PluginCall call) {
        Transfer transfer = transfers.get(call.getString("key", ""));
        if (transfer == null) {
            call.reject("The file transfer expired.");
            return;
        }
        try {
            String encoded = call.getString("data", "");
            if (encoded.length() > ((CHUNK_BYTES + 2) / 3) * 4) throw new IOException();
            byte[] chunk = Base64.decode(encoded, Base64.NO_WRAP);
            if (chunk.length > CHUNK_BYTES || transfer.file.length() + chunk.length > transfer.size) throw new IOException();
            try (FileOutputStream output = new FileOutputStream(transfer.file, true)) {
                output.write(chunk);
            }
            call.resolve();
        } catch (IOException | IllegalArgumentException error) {
            call.reject("Android could not write the file. Check the available storage.");
        }
    }

    @PluginMethod
    public void saveFile(PluginCall call) {
        Transfer transfer = completeTransfer(call);
        if (transfer == null) return;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(transfer.mime);
            intent.putExtra(Intent.EXTRA_TITLE, transfer.file.getName());
            try {
                startActivityForResult(call, intent, "onChooseDestination");
            } catch (Exception error) {
                call.reject("Android could not open the file destination picker.");
            }
            return;
        }

        ContentResolver resolver = getContext().getContentResolver();
        Uri destination = null;
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, transfer.file.getName());
            values.put(MediaStore.MediaColumns.MIME_TYPE, transfer.mime);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Limitless");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            destination = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (destination == null) throw new IOException();
            copyFile(transfer, destination);
            ContentValues ready = new ContentValues();
            ready.put(MediaStore.MediaColumns.IS_PENDING, 0);
            if (resolver.update(destination, ready, null, null) != 1) throw new IOException();
            saved(call, true, "Downloads/Limitless");
        } catch (Exception error) {
            if (destination != null) {
                try { resolver.delete(destination, null, null); } catch (Exception ignored) {}
            }
            call.reject("Android could not save the file in Downloads.");
        }
    }

    @ActivityCallback
    private void onChooseDestination(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            saved(call, false, "");
            return;
        }
        Transfer transfer = completeTransfer(call);
        if (transfer == null) return;
        getBridge().execute(() -> {
            try {
                copyFile(transfer, result.getData().getData());
                saved(call, true, "the selected location");
            } catch (Exception error) {
                call.reject("Android could not write the file to the selected location.");
            }
        });
    }

    @PluginMethod
    public void shareFile(PluginCall call) {
        Transfer transfer = completeTransfer(call);
        if (transfer == null) return;
        getActivity().runOnUiThread(() -> {
            try {
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", transfer.file);
                Intent intent = new Intent(Intent.ACTION_SEND);
                intent.setType(transfer.mime);
                intent.putExtra(Intent.EXTRA_STREAM, uri);
                intent.setClipData(ClipData.newRawUri(transfer.file.getName(), uri));
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getActivity().startActivity(Intent.createChooser(intent, null));
                transfers.remove(call.getString("key", ""));
                call.resolve();
            } catch (Exception error) {
                call.reject("Android could not open the share sheet.");
            }
        });
    }

    @PluginMethod
    public void discardFile(PluginCall call) {
        Transfer transfer = transfers.remove(call.getString("key", ""));
        if (transfer != null) removeFolder(transfer.file.getParentFile());
        call.resolve();
    }

    private Transfer completeTransfer(PluginCall call) {
        Transfer transfer = transfers.get(call.getString("key", ""));
        if (transfer == null || transfer.file.length() != transfer.size) {
            call.reject("The staged file is incomplete.");
            return null;
        }
        return transfer;
    }

    private void copyFile(Transfer transfer, Uri destination) throws IOException {
        try (FileInputStream input = new FileInputStream(transfer.file);
             OutputStream output = getContext().getContentResolver().openOutputStream(destination, "wt")) {
            if (output == null) throw new IOException();
            byte[] buffer = new byte[64 * 1024];
            for (int count; (count = input.read(buffer)) != -1;) output.write(buffer, 0, count);
        }
    }

    private void cleanCache(File root) {
        File[] folders = root.listFiles();
        if (folders == null) return;
        long expiry = System.currentTimeMillis() - CACHE_TTL;
        for (File folder : folders) {
            if (folder.lastModified() < expiry && !transfers.containsKey(folder.getName())) removeFolder(folder);
        }
    }

    private static void removeFolder(File folder) {
        File[] files = folder.listFiles();
        if (files != null) for (File file : files) file.delete();
        folder.delete();
    }

    private static void saved(PluginCall call, boolean saved, String location) {
        JSObject result = new JSObject();
        result.put("saved", saved);
        result.put("location", location);
        call.resolve(result);
    }
}
