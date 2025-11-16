import { createEffect } from "solid-js";
import { useConnectionState } from "@src/entities/connection/model/connection_state";
import { useNavigation } from "@src/providers/navigation";

export function useFocusNavigation() {
    const connectionState = useConnectionState();
    const navigation = useNavigation();

    createEffect(() => {
        const focusName = connectionState.focusedConfigurationName();
        const pages = navigation.stack();
        const depth = pages.length;
        const top = pages[depth - 1];

        if (focusName) {
            handleFocusedConfiguration(focusName, depth, top, navigation);
        } else {
            handleNoFocus(depth, top, navigation);
        }
    });
}

function handleFocusedConfiguration(
    focusName: string, 
    depth: number, 
    top: any, 
    navigation: any
) {
    if (depth === 1) {
        navigation.push({ type: "connection", configurationName: focusName });
        return;
    }
    
    if (depth === 2) {
        if (top?.type === "connection") {
            if (top.configurationName !== focusName) {
                navigation.replace({ type: "connection", configurationName: focusName });
            }
        } else {
            navigation.push({ type: "connection", configurationName: focusName });
        }
    }
}

function handleNoFocus(depth: number, top: any, navigation: any) {
    if (depth === 2 && top?.type === "connection") {
        navigation.pop();
    }
}