package de.leitstelle112.app;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

/**
 * Hülle der Android-App (ADR-0021). Die Oberfläche und die Simulation laufen im WebView.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Während einer Schicht soll der Bildschirm nicht ausgehen – wie ein Leitstellenmonitor.
        // Gilt nur, solange die App im Vordergrund ist.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
