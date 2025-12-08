#!/usr/bin/env python3
"""
Test script to verify individual activation in Scenario 1
Each OI should activate at different times with corresponding drone appearance
"""
import time
from routes.airspace import get_current_scenario, convert_geojson_to_operational_intent

def test_individual_activation():
    print("Testing individual Operational Intent activation in Scenario 1...")
    
    # Test first 10 steps to see the complete pattern
    for step in range(10):
        print(f"\n--- Step {step} (Time: {step * 10}s) ---")
        
        # Mock the time to get specific step
        original_time = time.time
        time.time = lambda: step * 10
        
        try:
            scenario, scenario_index, activation_step = get_current_scenario()
            
            if scenario_index == -1:
                print("Empty Scenario - No features")
                continue
                
            print(f"Scenario: {scenario_index + 1}, Activation Step: {activation_step}")
            
            # Test operational intent states
            oi_states = []
            activated_ois = []
            oi_index = 0
            
            for feature in scenario["features"]:
                if feature["properties"]["type"] == "Operational Intent":
                    oi = convert_geojson_to_operational_intent(feature, oi_index, scenario_index, activation_step)
                    state_str = str(oi.reference.state)
                    oi_states.append(state_str)
                    
                    if "ACTIVATED" in state_str:
                        activated_ois.append(oi_index)
                        
                    print(f"  OI {oi_index}: {state_str} (UUID: {str(oi.reference.id)[:8]}...)")
                    oi_index += 1
            
            # Count drone locations
            drone_count = sum(1 for f in scenario["features"] if f["properties"]["type"] == "Drone Location")
            
            print(f"  Activated OIs: {activated_ois}")
            print(f"  Expected visible drones: {len(activated_ois)}/{drone_count}")
            
            # Verify individual activation for Scenario 1
            if scenario_index == 0:
                if activation_step == 0:
                    expected_activated = []
                elif activation_step == 1:
                    expected_activated = [0]  # Only first OI
                elif activation_step == 2:
                    expected_activated = [0, 1]  # Both OIs
                else:
                    expected_activated = list(range(len(oi_states)))
                    
                if activated_ois == expected_activated:
                    print(f"  ✅ Correct individual activation")
                else:
                    print(f"  ❌ Expected {expected_activated} activated, got {activated_ois}")
                    
        finally:
            # Restore original time function
            time.time = original_time

if __name__ == "__main__":
    test_individual_activation()