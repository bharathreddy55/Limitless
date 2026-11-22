package app.limitless.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SessionVault {
    private static final String PROVIDER = "AndroidKeyStore";
    private static final String KEY_ALIAS = "limitless-device-vault-v1";
    private final SharedPreferences preferences;

    SessionVault(Context context) {
        preferences = context.getSharedPreferences("limitless_device_vault", Context.MODE_PRIVATE);
    }

    boolean contains(String name) {
        return preferences.contains(name);
    }

    synchronized void save(String name, String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key(true));
        cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));
        String data = encode(cipher.getIV()) + "." + encode(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)));
        if (!preferences.edit().putString(name, data).commit()) throw new IOException("Could not save encrypted data");
    }

    synchronized String read(String name) throws Exception {
        String data = preferences.getString(name, null);
        if (data == null) return null;
        String[] parts = data.split("\\.", 2);
        if (parts.length != 2) throw new IOException("Invalid encrypted data");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }

    synchronized void remove(String name) throws IOException {
        if (!preferences.edit().remove(name).commit()) throw new IOException("Could not clear encrypted data");
    }

    private SecretKey key(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance(PROVIDER);
        store.load(null);
        SecretKey key = (SecretKey) store.getKey(KEY_ALIAS, null);
        if (key != null) return key;
        if (!create) throw new IOException("Android Keystore key unavailable");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER);
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return generator.generateKey();
    }

    private static String encode(byte[] data) {
        return Base64.encodeToString(data, Base64.NO_WRAP);
    }
}
