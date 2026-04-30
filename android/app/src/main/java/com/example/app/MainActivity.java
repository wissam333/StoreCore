package com.example.app;

import android.webkit.PermissionRequest;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  public void onPermissionRequest(PermissionRequest request) {
    request.grant(request.getResources());
  }
}